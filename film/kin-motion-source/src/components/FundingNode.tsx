import { C, FONT } from "../tokens";

/** The shared funder: one solid navy disc inside a thin halo, with a mono caption. */
export const FundingNode = ({
  x,
  y,
  r,
  halo = 1,
  fill = C.navy,
  label = "SHARED FUNDER",
  labelOpacity = 0,
  knockout = "#FFFFFF",
}: {
  x: number;
  y: number;
  r: number;
  halo?: number;
  fill?: string;
  label?: string;
  labelOpacity?: number;
  knockout?: string;
}) => {
  if (r <= 0.2) return null;
  return (
    <g>
      {halo > 0 && <circle cx={x} cy={y} r={r * (1.32 + 0.1 * (1 - halo))} fill="none" stroke={fill} strokeWidth={2} opacity={0.35 * halo} />}
      <circle cx={x} cy={y} r={r} fill={fill} />
      {labelOpacity > 0 && (
        <text
          x={x}
          y={y + r * 1.32 + 34}
          textAnchor="middle"
          fontFamily={FONT.mono}
          fontSize={17}
          letterSpacing="0.16em"
          fill={fill}
          opacity={labelOpacity}
          stroke={knockout}
          strokeWidth={10}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {label}
        </text>
      )}
    </g>
  );
};
