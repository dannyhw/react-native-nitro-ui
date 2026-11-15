/**
 * Props every self-sizing component's Hybrid View must carry. They tell the
 * native size cache which configuration to answer for and which mounted view a
 * measured size belongs to.
 *
 * @internal Not semver surface: users never pass these.
 */
export interface NitroUiIntrinsicProps {
  /**
   * The size-affecting props of this instance, serialised by the JS wrapper: `""`
   * for a Switch, `"bordered|large|Save"` for a Button. Instances with the same
   * component and key share one cached size, so the key must cover exactly the
   * props that change the size. It never repeats the component name or anything
   * the environment decides (text size, density), which native tracks itself.
   *
   * Never optional (nitro#1184): `""` is a real configuration, not "unset".
   */
  nuiSizingKey: string;
  /**
   * Stable id of this mounted instance, from `useSizingId()`. Native reports its
   * measured size against it. It must come from that hook: the engine is
   * process-global and keyed by this number alone, so a per-component counter
   * would collide.
   *
   * `0` means sizing is off for this view, which is what a recycled or
   * not-yet-mounted native view holds.
   */
  nuiSizingId: number;
}
