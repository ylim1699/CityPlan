import * as T from 'three';

/* Sky dome: a gradient sky, a visible sun (and moon at night) and drifting clouds, painted on a sphere that follows
   the camera. The clouds live in the dome, not in the air, so they never cover the streets. */
const VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;  /* on the far plane: always behind the city */
}`;
const FRAG = `
uniform vec3 uSun, uMoon, uZenith, uHorizon, uSunCol, uCloudCol;
uniform float uTime, uDay, uCloudAmt;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  if (d.y < 0.0) col = uHorizon * (0.92 + 0.08 * (1.0 + d.y));  /* below the horizon: the haze the far land fades into */
  /* sun: a bright disc and a soft glow; moon: a small pale disc at night */
  float s = dot(d, uSun);
  col += uSunCol * (pow(max(s, 0.0), 12.0) * 0.18 + pow(max(s, 0.0), 220.0) * 0.6) * uDay;
  col = mix(col, vec3(1.0, 0.98, 0.9), smoothstep(0.9993, 0.9997, s) * step(0.0, uSun.y));
  float m = dot(d, uMoon);
  col = mix(col, vec3(0.86, 0.9, 1.0), smoothstep(0.9995, 0.9998, m) * (1.0 - uDay) * step(0.0, uMoon.y));
  /* clouds: noise projected onto a flat layer overhead, drifting with the wind */
  if (d.y > 0.0) {
    vec2 q = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
    float n = fbm(q) + 0.5 * fbm(q * 2.7 - uTime * 0.006) - 0.25;
    float c = smoothstep(1.0 - uCloudAmt, 1.0 - uCloudAmt + 0.28, n) * smoothstep(0.0, 0.22, d.y);
    float lit = 0.78 + 0.22 * pow(max(s, 0.0), 4.0);  /* the side toward the sun is brighter */
    col = mix(col, uCloudCol * lit, c * 0.95);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export type Sky = { mesh: T.Mesh; set: (o: { sun: T.Vector3; moon: T.Vector3; day: number; dusk: number }) => T.Color; tick: (dt: number, cam: T.Camera) => void };

export function createSky(): Sky {
  const U = {
    uSun: { value: new T.Vector3(0, 1, 0) }, uMoon: { value: new T.Vector3(0, 1, 0) },
    uZenith: { value: new T.Color() }, uHorizon: { value: new T.Color() }, uSunCol: { value: new T.Color() }, uCloudCol: { value: new T.Color() },
    uTime: { value: 0 }, uDay: { value: 1 }, uCloudAmt: { value: 0.52 }
  };
  const mat = new T.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, side: T.BackSide, depthWrite: false, depthTest: false, fog: false });
  const mesh = new T.Mesh(new T.SphereGeometry(100, 48, 24), mat);
  mesh.renderOrder = -1000; mesh.frustumCulled = false;
  /* day, dusk and night palettes */
  const C = {
    dayZ: new T.Color(0x2f7fd6), dayH: new T.Color(0xb9dcf4),
    duskZ: new T.Color(0x3a4f86), duskH: new T.Color(0xf2a066),
    nightZ: new T.Color(0x050914), nightH: new T.Color(0x16203a),
    cloudDay: new T.Color(0xffffff), cloudDusk: new T.Color(0xf6c3a0), cloudNight: new T.Color(0x2a3248)
  };
  const tmp = new T.Color();
  return {
    mesh,
    set({ sun, moon, day, dusk }) {
      U.uSun.value.copy(sun); U.uMoon.value.copy(moon); U.uDay.value = day;
      U.uZenith.value.copy(C.nightZ).lerp(C.dayZ, day).lerp(C.duskZ, dusk * 0.6);
      U.uHorizon.value.copy(C.nightH).lerp(C.dayH, day).lerp(C.duskH, dusk * 0.75);
      U.uSunCol.value.setHex(dusk > 0.2 ? 0xffb070 : 0xfff2d8);
      U.uCloudCol.value.copy(C.cloudNight).lerp(C.cloudDay, day).lerp(C.cloudDusk, dusk * 0.7);
      return tmp.copy(U.uHorizon.value);  /* the fog matches the horizon so far land melts into the sky */
    },
    tick(dt, cam) { U.uTime.value += dt; mesh.position.copy(cam.position); }
  };
}
