import { organicPath, type Organic } from "../lib/organic";

/** One organic form. Hollow forms render as rings through the even-odd fill rule. */
export const OrganicShape = ({ shape, fill, opacity = 1 }: { shape: Organic; fill: string; opacity?: number }) => {
  const d = organicPath(shape);
  if (!d || opacity <= 0.001) return null;
  return <path d={d} fill={fill} fillRule="evenodd" opacity={opacity} />;
};

export interface PlacedShape {
  key: string | number;
  shape: Organic;
  fill: string;
  opacity?: number;
}

/** A field of organic forms (the KIN pattern, or any arrangement of it). */
export const OrganicPattern = ({ shapes }: { shapes: PlacedShape[] }) => (
  <g>
    {shapes.map((s) => (
      <OrganicShape key={s.key} shape={s.shape} fill={s.fill} opacity={s.opacity} />
    ))}
  </g>
);
