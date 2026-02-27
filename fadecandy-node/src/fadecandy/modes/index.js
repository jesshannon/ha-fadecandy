import BreatheMode from './BreatheMode.js';
import RainbowColumnsMode from './RainbowColumnsMode.js';
import SparkleMode from './SparkleMode.js';

export function buildModes(manager) {
  const instances = [BreatheMode, RainbowColumnsMode, SparkleMode].map((Mode) => new Mode(manager));
  return instances.reduce((acc, mode) => {
    acc[mode.id] = mode;
    return acc;
  }, {});
}

export default buildModes;
