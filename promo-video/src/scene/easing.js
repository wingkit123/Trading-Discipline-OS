export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a, b, t) => a + (b - a) * t;

export const remap = (val, inMin, inMax, outMin = 0, outMax = 1) => {
  const t = clamp01((val - inMin) / (inMax - inMin));
  return outMin + (outMax - outMin) * t;
};

export const easeOutCubic = (t) => {
  const u = clamp01(t);
  return 1 - Math.pow(1 - u, 3);
};

export const easeInOutCubic = (t) => {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};

export const easeOutQuart = (t) => {
  const u = clamp01(t);
  return 1 - Math.pow(1 - u, 4);
};

export const easeOutExpo = (t) => {
  const u = clamp01(t);
  return u === 1 ? 1 : 1 - Math.pow(2, -10 * u);
};

export const springOut = (t, damping = 6.5, freq = 11) => {
  const u = clamp01(t);
  if (u === 0) return 0;
  if (u === 1) return 1;
  return 1 - Math.exp(-damping * u) * Math.cos(freq * u);
};
