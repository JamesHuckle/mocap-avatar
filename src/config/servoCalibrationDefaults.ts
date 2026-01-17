import type {ServoCalibration} from '../components/ServoMapping';

/**
 * Default per-servo calibration values used on a fresh load (or after "Reset All").
 * These are intentionally hardcoded in one place so they're easy to tweak.
 */
export const DEFAULT_SERVO_CALIBRATIONS: Record<string, ServoCalibration> = {
  // From your latest captured ranges:
  // 7: left shoulder side
  '7': {inputMin: 81, inputMax: 0, invert: false},
  // 6: left elbow up
  '6': {inputMin: 74, inputMax: 0, invert: false},
  // 15: right shoulder side
  '15': {inputMin: 63, inputMax: 165, invert: false},
  // 14: right elbow up
  '14': {inputMin: 126, inputMax: 180, invert: false},
};

