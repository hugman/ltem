/** markdown-it-mark has no type declarations of its own. */
declare module "markdown-it-mark" {
  const mark: (md: import("markdown-it").default) => void;
  export default mark;
}
