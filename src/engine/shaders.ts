export const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
uniform mat3 u_uvTransform;
out vec2 v_uv;      // source-texture space (may be rotated)
out vec2 v_screen;  // output space, always top-left origin
void main() {
  // Screen-space UV: y flipped so v=0 is the top of the output.
  vec2 screen = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  v_screen = screen;
  v_uv = (u_uvTransform * vec3(screen, 1.0)).xy;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec2 v_screen;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2  u_texel;     // 1.0 / source resolution
uniform float u_aspect;    // output width / height
uniform float u_seed;      // animates grain per frame
uniform float u_split;     // 0..1 compare wipe, < 0 disables

uniform float u_exposure;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform float u_temperature;
uniform float u_tint;
uniform float u_vibrance;
uniform float u_saturation;
uniform float u_sharpness;
uniform float u_fade;
uniform float u_vignette;
uniform float u_grain;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 toLinear(vec3 c) {
  c = max(c, 0.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

/** Gain the channels but hand back the luminance we started with. */
vec3 gainPreservingLuma(vec3 lin, vec3 gain) {
  float before = dot(lin, LUMA);
  vec3 out_ = lin * gain;
  float after = dot(out_, LUMA);
  return out_ * (after > 1e-5 ? before / after : 1.0);
}

/** Re-target a pixel's luminance while holding its hue and saturation. */
vec3 retargetLuma(vec3 c, float lum, float newLum) {
  vec3 scaled = c * (newLum / max(lum, 1e-3));
  // Near-black pixels have no meaningful ratio, so fade to a neutral lift.
  return mix(vec3(newLum), scaled, smoothstep(0.0, 0.03, lum));
}

/** 3x3 gaussian, used as the blur term of an unsharp mask. */
vec3 blur3x3(vec2 uv) {
  vec3 sum = texture(u_tex, uv).rgb * 4.0;
  sum += texture(u_tex, uv + vec2(-u_texel.x, 0.0)).rgb * 2.0;
  sum += texture(u_tex, uv + vec2( u_texel.x, 0.0)).rgb * 2.0;
  sum += texture(u_tex, uv + vec2(0.0, -u_texel.y)).rgb * 2.0;
  sum += texture(u_tex, uv + vec2(0.0,  u_texel.y)).rgb * 2.0;
  sum += texture(u_tex, uv + vec2(-u_texel.x, -u_texel.y)).rgb;
  sum += texture(u_tex, uv + vec2( u_texel.x, -u_texel.y)).rgb;
  sum += texture(u_tex, uv + vec2(-u_texel.x,  u_texel.y)).rgb;
  sum += texture(u_tex, uv + vec2( u_texel.x,  u_texel.y)).rgb;
  return sum / 16.0;
}

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

vec3 process(vec3 col) {
  // --- Exposure and white balance, in linear light -----------------------
  vec3 lin = toLinear(col);
  lin *= exp2(u_exposure * 2.0);

  if (abs(u_temperature) > 0.001) {
    lin = gainPreservingLuma(lin, vec3(1.0 + 0.30 * u_temperature, 1.0, 1.0 - 0.30 * u_temperature));
  }
  if (abs(u_tint) > 0.001) {
    lin = gainPreservingLuma(lin, vec3(1.0 + 0.16 * u_tint, 1.0 - 0.18 * u_tint, 1.0 + 0.16 * u_tint));
  }
  col = toSRGB(lin);

  // --- Tone: highlights / shadows are luminance-masked -------------------
  if (abs(u_highlights) > 0.001 || abs(u_shadows) > 0.001) {
    float lum = dot(col, LUMA);
    float shadowAdj = u_shadows * 0.50 * pow(1.0 - lum, 2.0);
    float highAdj   = u_highlights * 0.50 * pow(lum, 2.0);
    col = retargetLuma(col, lum, clamp(lum + shadowAdj + highAdj, 0.0, 1.0));
  }

  // --- Black and white points (a levels remap) ---------------------------
  if (abs(u_blacks) > 0.001 || abs(u_whites) > 0.001) {
    float blackPoint = -u_blacks * 0.15;
    float whitePoint = 1.0 - u_whites * 0.20;
    col = (col - blackPoint) / max(whitePoint - blackPoint, 0.05);
  }

  // --- Contrast: S-curve up, linear flatten down -------------------------
  col = clamp(col, 0.0, 1.0);
  col = mix(col, smoothstep(0.0, 1.0, col), max(u_contrast, 0.0));
  col = mix(col, 0.5 + (col - 0.5) * 0.5, max(-u_contrast, 0.0));

  // --- Brightness as a midtone gamma -------------------------------------
  if (abs(u_brightness) > 0.001) {
    col = pow(max(col, 0.0), vec3(1.0 / (1.0 + u_brightness * 0.6)));
  }

  // --- Vibrance: weighted toward already-muted colour --------------------
  if (abs(u_vibrance) > 0.001) {
    float mx = max(col.r, max(col.g, col.b));
    float mn = min(col.r, min(col.g, col.b));
    float sat = mx - mn;
    float amount = u_vibrance * (1.0 - sat);
    // Hold back on skin tones, where over-saturation reads as sunburn.
    float skin = smoothstep(0.06, 0.35, col.r - col.b) * smoothstep(0.0, 0.18, col.g - col.b);
    amount *= 1.0 - 0.55 * skin;
    col = mix(vec3(dot(col, LUMA)), col, max(1.0 + amount * 1.3, 0.0));
  }

  // --- Saturation ---------------------------------------------------------
  if (abs(u_saturation) > 0.001) {
    col = mix(vec3(dot(col, LUMA)), col, 1.0 + u_saturation);
  }

  // --- Fade (matte film base) --------------------------------------------
  if (u_fade > 0.001) {
    col = col * (1.0 - 0.22 * u_fade) + 0.16 * u_fade;
  }

  return col;
}

void main() {
  vec3 raw = texture(u_tex, v_uv).rgb;

  vec3 col = raw;
  if (u_sharpness > 0.001) {
    col = clamp(col + (col - blur3x3(v_uv)) * u_sharpness * 2.0, 0.0, 1.0);
  }

  col = process(col);

  // --- Vignette, in output space so it always frames the visible image ---
  if (abs(u_vignette) > 0.001) {
    vec2 d = v_screen - 0.5;
    d.x *= max(u_aspect, 0.0001);
    float r = length(d) / (0.5 * sqrt(1.0 + u_aspect * u_aspect));
    col *= 1.0 - u_vignette * smoothstep(0.35, 1.0, r) * 0.85;
  }

  // --- Grain --------------------------------------------------------------
  if (u_grain > 0.001) {
    float n = hash21(v_screen * 1024.0 + u_seed);
    float lum = dot(col, LUMA);
    // Film grain is strongest in the midtones, not in clipped black or white.
    float weight = 1.0 - abs(lum * 2.0 - 1.0) * 0.6;
    col += (n - 0.5) * u_grain * 0.16 * weight;
  }

  col = clamp(col, 0.0, 1.0);

  // --- Before / after wipe -----------------------------------------------
  if (u_split >= 0.0) {
    col = mix(raw, col, step(u_split, v_screen.x));
    float line = 1.0 - smoothstep(0.0, 0.0016, abs(v_screen.x - u_split));
    col = mix(col, vec3(1.0), line * 0.85);
  }

  fragColor = vec4(col, 1.0);
}`;
