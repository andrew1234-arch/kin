import { Composition } from "remotion";
import "./fonts";
import { Film } from "./Film";
import { DURATION, FPS, H, W } from "./tokens";

export const RemotionRoot = () => (
  <Composition id="KinBrandFilm" component={Film} durationInFrames={DURATION} fps={FPS} width={W} height={H} />
);
