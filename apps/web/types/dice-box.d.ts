// A biblioteca não traz tipos; só o construtor é usado (o resto está tipado em components/dice-3d.tsx).
declare module '@3d-dice/dice-box-threejs' {
  const DiceBox: new (selector: string, config: Record<string, unknown>) => unknown
  export default DiceBox
}
