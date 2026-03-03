import React from 'react';

/**
 * Parses inline markdown in a single line and returns React nodes.
 * Handles: **bold**, *italic*, `code`, ~~strikethrough~~, [text](url), plain URLs, @mentions
 */
function renderInline(content: string, keyOffset: number = 0): React.ReactNode[] {
  const TOKEN = /(\*\*(.+?)\*\*)|(\*([^*\n]+?)\*)|(`([^`\n]+?)`)|(~~(.+?)~~)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'\])]+)|(@[\w][\w .'-]*[\w]|@\w+)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = keyOffset;
  while ((m = TOKEN.exec(content)) !== null) {
    if (m.index > last) nodes.push(content.slice(last, m.index));
    if (m[1]) {
      nodes.push(<strong key={key++} className="font-bold">{m[2]}</strong>);
    } else if (m[3]) {
      nodes.push(<em key={key++} className="leading-[22px]">{m[4]}</em>);
    } else if (m[5]) {
      nodes.push(<code key={key++} className="rounded-[3px] bg-slack-code-bg px-1 py-0.5 font-mono text-[0.875em]">{m[6]}</code>);
    } else if (m[7]) {
      nodes.push(<s key={key++}>{m[8]}</s>);
    } else if (m[9]) {
      nodes.push(<a key={key++} href={m[10]} target="_blank" rel="noopener noreferrer" className="text-slack-link underline hover:text-slack-link-hover">{m[9]}</a>);
    } else if (m[11]) {
      nodes.push(<a key={key++} href={m[11]} target="_blank" rel="noopener noreferrer" className="text-slack-link underline hover:text-slack-link-hover">{m[11]}</a>);
    } else if (m[12]) {
      nodes.push(<span key={key++} className="mention-highlight rounded bg-slack-mention px-[2px] text-slack-link font-medium cursor-pointer hover:bg-slack-mention-hover">{m[12]}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) nodes.push(content.slice(last));
  return nodes;
}

/**
 * Parses message content and returns React nodes.
 * Block-level parsing (blockquotes, code blocks) runs first, then inline markdown.
 */
export function renderMessageContent(content: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let key = 0;

  // Split into segments: code blocks (```...```) and everything else
  const CODE_BLOCK = /```([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = CODE_BLOCK.exec(content)) !== null) {
    // Process text before the code block
    if (m.index > last) {
      const before = content.slice(last, m.index);
      nodes.push(...renderLines(before, key));
      key += 1000;
    }
    // Render the code block
    const codeContent = m[1].replace(/^\n/, '').replace(/\n$/, '');
    nodes.push(
      <pre key={key++} className="my-1 rounded bg-slack-code-bg px-3 py-2 font-mono text-[0.875em] overflow-x-auto whitespace-pre-wrap">
        <code>{codeContent}</code>
      </pre>
    );
    last = m.index + m[0].length;
  }

  // Process any remaining text after the last code block
  if (last < content.length) {
    const remaining = content.slice(last);
    nodes.push(...renderLines(remaining, key));
  }

  return nodes.length > 0 ? nodes : content;
}

/**
 * Renders a chunk of text that may contain multiple lines, some of which may be blockquotes.
 */
function renderLines(text: string, keyOffset: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let key = keyOffset;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('> ')) {
      // Collect consecutive blockquote lines
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      const quoteContent = quoteLines.join('\n');
      nodes.push(
        <blockquote key={key++} className="border-l-4 border-slack-border-dark pl-3 my-0.5 text-slack-secondary italic">
          {renderInline(quoteContent, key * 100)}
        </blockquote>
      );
    } else {
      // Normal line — render inline, add newline between lines (but not after the last)
      if (nodes.length > 0 && i > 0) {
        nodes.push('\n');
      }
      const inlineNodes = renderInline(line, key * 100);
      nodes.push(...inlineNodes);
      key++;
      i++;
    }
  }

  return nodes;
}
