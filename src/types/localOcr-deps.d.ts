declare module 'js-yaml' {
  export function load(str: string): unknown;
  export function dump(obj: unknown): string;
}

declare module 'clipper-lib' {
  namespace ClipperLib {
    enum JoinType {
      jtSquare = 0,
      jtRound = 1,
      jtMiter = 2,
    }
    enum EndType {
      etClosedPolygon = 0,
      etClosedLine = 1,
      etOpenButt = 2,
      etOpenSquare = 3,
      etOpenRound = 4,
    }
    class ClipperOffset {
      constructor(miterLimit?: number, roundPrecision?: number);
      AddPath(
        path: Array<{ X: number; Y: number }>,
        joinType: JoinType,
        endType: EndType
      ): void;
      Execute(
        solution: Array<Array<{ X: number; Y: number }>>,
        delta: number
      ): void;
    }
  }
  export default ClipperLib;
}
