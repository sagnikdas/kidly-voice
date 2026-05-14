// Vibration API — works on Android Chrome. Silently ignored on iOS Safari.
const vib = (p) => { try { navigator.vibrate?.(p) } catch {} }

export const haptic = {
  light:   () => vib(8),
  medium:  () => vib(15),
  success: () => vib([10, 40, 10]),
  select:  () => vib(6),
}
