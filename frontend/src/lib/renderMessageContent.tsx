import React from 'react';

/**
 * Parses inline markdown in message content and returns React nodes.
 * Handles: **bold**, *italic*, `code`, [text](url), @mentions
 */
export function renderMessageContent(content: string): React.ReactNode {
  const TOKEN = /(\*\*(.+?)\*\*)|(\*([^*\n]+?)\*)|(`([^`\n]+?)`)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(@[\w][\w .'-]*[\w]|@\w+)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = TOKEN.exec(content)) !== null) {
    if (m.index > last) nodes.push(content.slice(last, m.index));
    if (m[1]) {
      nodes.push(<strong key={key++} className="font-bold">{m[2]}</strong>);
    } else if (m[3]) {
      nodes.push(<em key={key++} className="leading-[22px]">{m[4]}</em>);
    } else if (m[5]) {
      nodes.push(<code key={key++} className="rounded-[3px] bg-[rgba(29,28,29,0.08)] px-1 py-0.5 font-mono text-[0.875em]">{m[6]}</code>);
    } else if (m[7]) {
      nodes.push(<a key={key++} href={m[8]} target="_blank" rel="noopener noreferrer" className="text-[#1264A3] underline hover:text-[#0d4f8b]">{m[7]}</a>);
    } else if (m[9]) {
      nodes.push(<span key={key++} className="mention-highlight rounded bg-[#1d9bd11a] px-[2px] text-[#1264A3] font-medium cursor-pointer hover:bg-[#1d9bd133]">{m[9]}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) nodes.push(content.slice(last));
  return nodes.length > 0 ? nodes : content;
}
