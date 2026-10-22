/** markdown-it-footnote has no type declarations of its own. */
declare module "markdown-it-footnote" {
  const footnote: (md: import("markdown-it").default) => void;
  export default footnote;
}
