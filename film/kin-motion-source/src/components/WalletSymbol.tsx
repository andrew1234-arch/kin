import { organicPath, type Organic } from "../lib/organic";
import { C, FONT } from "../tokens";

/**
 * A wallet: a rounded navy slab from the pattern family with a small clasp. `form` 0→1 morphs the clasp in as a
 * pattern shape becomes a wallet; `marker` lights the clasp blue (the shared-funding hint); `label` is its index.
 */
export const WalletSymbol = ({
  shape,
  fill = C.navy,
  form = 1,
  marker = 0,
  label,
  labelOpacity = 0,
  labelPos,
  claspColor = C.white,
  labelColor = C.navy,
}: {
  shape: Organic;
  fill?: string;
  form?: number;
  marker?: number;
  label?: string;
  labelOpacity?: number;
  labelPos?: { x: number; y: number };
  claspColor?: string;
  labelColor?: string;
}) => {
  const d = organicPath(shape);
  if (!d) return null;
  const k = shape.s * Math.min(shape.w / 118, shape.h / 80);
  const claspR = 7.5 * k * form;
  return (
    <g>
      <path d={d} fill={fill} fillRule="evenodd" />
      {claspR > 0.3 && (
        <>
          <circle cx={shape.x + 30 * k} cy={shape.y} r={claspR + 3 * k * marker} fill={C.blue} opacity={marker} />
          <circle cx={shape.x + 30 * k} cy={shape.y} r={claspR} fill={claspColor} />
        </>
      )}
      {label && labelOpacity > 0 && labelPos && (
        <text
          x={labelPos.x}
          y={labelPos.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily={FONT.mono}
          fontSize={17}
          letterSpacing="0.12em"
          fill={labelColor}
          opacity={labelOpacity}
        >
          {label}
        </text>
      )}
    </g>
  );
};
