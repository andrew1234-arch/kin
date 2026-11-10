import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/** The site's own typefaces (Geist and Geist Mono, SIL OFL 1.1, from the `geist` npm package). */
const faces: [string, string, string][] = [
  ["Geist", "fonts/Geist-Regular.woff2", "400"],
  ["Geist", "fonts/Geist-Medium.woff2", "500"],
  ["Geist", "fonts/Geist-SemiBold.woff2", "600"],
  ["Geist Mono", "fonts/GeistMono-Regular.woff2", "400"],
  ["Geist Mono", "fonts/GeistMono-Medium.woff2", "500"],
];

export const fontsReady = Promise.all(
  faces.map(([family, file, weight]) => loadFont({ family, url: staticFile(file), weight, format: "woff2" })),
);
