import BreatheMode from './BreatheMode.js';
import FadeQueueMode from './FadeQueueMode.js';
import RainbowColumnsMode from './RainbowColumnsMode.js';
import SparkleMode from './SparkleMode.js';

export function buildModes(manager) {
  const instances = [BreatheMode, FadeQueueMode, RainbowColumnsMode, SparkleMode].map((Mode) => new Mode(manager));
  return instances.reduce((acc, mode) => {
    acc[mode.id] = mode;
    return acc;
  }, {});
}

export default buildModes;
