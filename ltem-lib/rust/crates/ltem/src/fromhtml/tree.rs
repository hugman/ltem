//! A small, forgiving HTML tree builder that closes table elements implicitly.
//!
//! The tree is an arena of nodes; traversals use explicit stacks, so deeply nested
//! input cannot overflow the call stack.

use super::tokenizer::{tokenize, Sink};

/// Void elements: they have no content and no end tag.
const VOID: [&str; 13] = [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr",
];
/// Table cells.
pub(crate) const CELL: [&str; 2] = ["td", "th"];
/// Row groups.
pub(crate) const GROUP: [&str; 3] = ["thead", "tbody", "tfoot"];

/// A child of an element: another element (an index into the arena) or text.
#[derive(Clone, Debug)]
pub(crate) enum Child {
    Node(usize),
    Text(String),
}

/// An element.
#[derive(Clone, Debug)]
pub(crate) struct Node {
    pub tag: String,
    /// Attributes in source order; a repeated name takes its last value.
    attrs: Vec<(String, String)>,
    pub children: Vec<Child>,
    pub parent: Option<usize>,
}

impl Node {
    /// The value of an attribute, if present.
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .rev()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

/// A parsed document. Node 0 is the root.
pub(crate) struct Tree {
    pub nodes: Vec<Node>,
}

pub(crate) const ROOT: usize = 0;

impl Tree {
    /// Parse an HTML document.
    pub fn parse(html: &str) -> Tree {
        let mut builder = Builder {
            tree: Tree {
                nodes: vec![Node {
                    tag: "#root".to_string(),
                    attrs: Vec::new(),
                    children: Vec::new(),
                    parent: None,
                }],
            },
            cur: ROOT,
        };
        tokenize(html, &mut builder);
        builder.tree
    }

    pub fn node(&self, i: usize) -> &Node {
        &self.nodes[i]
    }

    /// The elements with the given tag below `node`, in document order. The search does
    /// not descend into a match, nor into elements whose tag is in `stop`.
    pub fn find_all(&self, node: usize, tag: &str, stop: &[&str]) -> Vec<usize> {
        let mut out = Vec::new();
        // A stack of (element, index of its next child to visit).
        let mut stack = vec![(node, 0usize)];
        while let Some(top) = stack.last_mut() {
            let (n, i) = *top;
            let Some(child) = self.nodes[n].children.get(i) else {
                stack.pop();
                continue;
            };
            top.1 += 1;
            if let Child::Node(c) = *child {
                let t = self.nodes[c].tag.as_str();
                if t == tag {
                    out.push(c);
                } else if !stop.contains(&t) {
                    stack.push((c, 0));
                }
            }
        }
        out
    }

    /// All text below `node`, in document order.
    pub fn text_content(&self, node: usize) -> String {
        let mut out = String::new();
        let mut stack = vec![(node, 0usize)];
        while let Some(top) = stack.last_mut() {
            let (n, i) = *top;
            let Some(child) = self.nodes[n].children.get(i) else {
                stack.pop();
                continue;
            };
            top.1 += 1;
            match child {
                Child::Text(s) => out.push_str(s),
                Child::Node(c) => stack.push((*c, 0)),
            }
        }
        out
    }

    /// The element children of `node` that are table cells.
    pub fn cells(&self, node: usize) -> Vec<usize> {
        self.nodes[node]
            .children
            .iter()
            .filter_map(|c| match c {
                Child::Node(i) if CELL.contains(&self.nodes[*i].tag.as_str()) => Some(*i),
                _ => None,
            })
            .collect()
    }
}

struct Builder {
    tree: Tree,
    cur: usize,
}

impl Builder {
    /// Close open elements up to and including the nearest one in `tags`, but not past
    /// one in `stop`.
    fn close_until(&mut self, tags: &[&str], stop: &[&str]) {
        let mut node = Some(self.cur);
        while let Some(n) = node {
            let tag = self.tree.nodes[n].tag.as_str();
            if stop.contains(&tag) {
                return;
            }
            if tags.contains(&tag) {
                self.cur = self.tree.nodes[n].parent.unwrap_or(ROOT);
                return;
            }
            node = self.tree.nodes[n].parent;
        }
    }

    fn append(&mut self, tag: String, attrs: Vec<(String, Option<String>)>) -> usize {
        let index = self.tree.nodes.len();
        let attrs = attrs
            .into_iter()
            .map(|(k, v)| (k, v.unwrap_or_default()))
            .collect();
        self.tree.nodes.push(Node {
            tag,
            attrs,
            children: Vec::new(),
            parent: Some(self.cur),
        });
        self.tree.nodes[self.cur].children.push(Child::Node(index));
        index
    }
}

impl Sink for Builder {
    fn start_tag(&mut self, tag: String, attrs: Vec<(String, Option<String>)>) {
        match tag.as_str() {
            "td" | "th" => self.close_until(&CELL, &["tr", "table"]),
            "tr" => {
                self.close_until(&["tr"], &["table", "thead", "tbody", "tfoot"]);
                self.close_until(&CELL, &["table"]);
            }
            "thead" | "tbody" | "tfoot" => self.close_until(&GROUP, &["table"]),
            "p" => self.close_until(&["p"], &["td", "th", "table"]),
            "li" => self.close_until(&["li"], &["ul", "ol", "td", "th"]),
            _ => {}
        }
        let void = VOID.contains(&tag.as_str());
        let index = self.append(tag, attrs);
        if !void {
            self.cur = index;
        }
    }

    fn start_end_tag(&mut self, tag: String, attrs: Vec<(String, Option<String>)>) {
        self.append(tag, attrs);
    }

    fn end_tag(&mut self, tag: String) {
        if VOID.contains(&tag.as_str()) {
            return;
        }
        let mut node = self.cur;
        while node != ROOT {
            if self.tree.nodes[node].tag == tag {
                self.cur = self.tree.nodes[node].parent.unwrap_or(ROOT);
                return;
            }
            node = self.tree.nodes[node].parent.unwrap_or(ROOT);
        }
    }

    fn data(&mut self, text: String) {
        // The tokenizer may deliver one run of text in pieces (it splits at a lone "<").
        // Keep a run together so that escaping sees its neighbours.
        let children = &mut self.tree.nodes[self.cur].children;
        match children.last_mut() {
            Some(Child::Text(last)) => last.push_str(&text),
            _ => children.push(Child::Text(text)),
        }
    }
}
