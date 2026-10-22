// markdown-it 14 is installed under the alias "markdown-it-14" for testing. It ships no
// types of its own; its API is the one typed by markdown-it 15.
declare module "markdown-it-14" {
  import markdownit from "markdown-it";
  export default markdownit;
}
