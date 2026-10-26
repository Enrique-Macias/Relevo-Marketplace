/**
 * Logos de RLVO (Paleta 06, DESIGN-1), transcritos a react-native-svg desde
 * `design/rlvo-final-brand/` — las copias recoloreadas del kit oficial de
 * `assets/brand/`. Solo el color es parámetro; la geometría no se toca. Si el
 * kit cambia, se vuelven a transcribir desde esos archivos (no a mano).
 *
 * El ancho se elige y el alto sale de la proporción del viewBox.
 */
import Svg, { G, Path } from "react-native-svg";

type LogoProps = { width: number; color: string };

/** viewBox 770×290. */
export function LogoHorizontal({ width, color }: LogoProps) {
  return (
    <Svg
      width={width}
      height={(width * 290) / 770}
      viewBox="0 0 770 290"
      accessible={false}
    >
      <G transform="translate(20, 0)">
        <G
          fill="none"
          stroke={color}
          strokeWidth="42"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="M 137 43 L 205 111 L 160 159" />
          <Path d="M 108 113 L 61 166 L 126 230" />
        </G>
      </G>
      <G fill={color}>
        <Path
          d="M735 831Q856 831 908.5 876.0Q961 921 961 1024Q961 1126 908.5 1170.0Q856 1214 735 1214H573V831ZM573 565V0H188V1493H776Q1071 1493 1208.5 1394.0Q1346 1295 1346 1081Q1346 933 1274.5 838.0Q1203 743 1059 698Q1138 680 1200.5 616.5Q1263 553 1327 424L1536 0H1126L944 371Q889 483 832.5 524.0Q776 565 682 565Z"
          transform="translate(285.000, 182.000) scale(0.072266, -0.072266)"
        />
        <Path
          d="M188 1493H573V291H1249V0H188Z"
          transform="translate(391.736, 182.000) scale(0.072266, -0.072266)"
        />
        <Path
          d="M10 1493H397L793 391L1188 1493H1575L1022 0H563Z"
          transform="translate(478.817, 182.000) scale(0.072266, -0.072266)"
        />
        <Path
          d="M870 1241Q694 1241 597.0 1111.0Q500 981 500 745Q500 510 597.0 380.0Q694 250 870 250Q1047 250 1144.0 380.0Q1241 510 1241 745Q1241 981 1144.0 1111.0Q1047 1241 870 1241ZM870 1520Q1230 1520 1434.0 1314.0Q1638 1108 1638 745Q1638 383 1434.0 177.0Q1230 -29 870 -29Q511 -29 306.5 177.0Q102 383 102 745Q102 1108 306.5 1314.0Q511 1520 870 1520Z"
          transform="translate(586.131, 182.000) scale(0.072266, -0.072266)"
        />
      </G>
    </Svg>
  );
}

/** viewBox 650×420. */
export function LogoVertical({ width, color }: LogoProps) {
  return (
    <Svg
      width={width}
      height={(width * 420) / 650}
      viewBox="0 0 650 420"
      accessible={false}
    >
      <G transform="translate(155, 30) scale(.85)">
        <G
          fill="none"
          stroke={color}
          strokeWidth="42"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="M 137 43 L 205 111 L 160 159" />
          <Path d="M 108 113 L 61 166 L 126 230" />
        </G>
      </G>
      <G fill={color} transform="translate(159.123, 340)">
        <Path
          d="M735 831Q856 831 908.5 876.0Q961 921 961 1024Q961 1126 908.5 1170.0Q856 1214 735 1214H573V831ZM573 565V0H188V1493H776Q1071 1493 1208.5 1394.0Q1346 1295 1346 1081Q1346 933 1274.5 838.0Q1203 743 1059 698Q1138 680 1200.5 616.5Q1263 553 1327 424L1536 0H1126L944 371Q889 483 832.5 524.0Q776 565 682 565Z"
          transform="translate(0.000, 0.000) scale(0.056152, -0.056152)"
        />
        <Path
          d="M188 1493H573V291H1249V0H188Z"
          transform="translate(82.937, 0.000) scale(0.056152, -0.056152)"
        />
        <Path
          d="M10 1493H397L793 391L1188 1493H1575L1022 0H563Z"
          transform="translate(150.601, 0.000) scale(0.056152, -0.056152)"
        />
        <Path
          d="M870 1241Q694 1241 597.0 1111.0Q500 981 500 745Q500 510 597.0 380.0Q694 250 870 250Q1047 250 1144.0 380.0Q1241 510 1241 745Q1241 981 1144.0 1111.0Q1047 1241 870 1241ZM870 1520Q1230 1520 1434.0 1314.0Q1638 1108 1638 745Q1638 383 1434.0 177.0Q1230 -29 870 -29Q511 -29 306.5 177.0Q102 383 102 745Q102 1108 306.5 1314.0Q511 1520 870 1520Z"
          transform="translate(233.987, 0.000) scale(0.056152, -0.056152)"
        />
      </G>
    </Svg>
  );
}

/** viewBox 300×300. */
export function Isotipo({ width, color }: LogoProps) {
  return (
    <Svg
      width={width}
      height={(width * 300) / 300}
      viewBox="0 0 300 300"
      accessible={false}
    >
      <G transform="translate(23, 15) scale(.92)">
        <G
          fill="none"
          stroke={color}
          strokeWidth="42"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Path d="M 137 43 L 205 111 L 160 159" />
          <Path d="M 108 113 L 61 166 L 126 230" />
        </G>
      </G>
    </Svg>
  );
}
