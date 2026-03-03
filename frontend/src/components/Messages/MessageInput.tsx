import { useRef, useEffect, useCallback, useState } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import {
  Bold,
  Italic,
  Strikethrough,
  Link,
  ListOrdered,
  List,
  Code,
  CodeSquare,
  Quote,
  Plus,
  AtSign,
  Smile,
  SendHorizontal,
  X,
  FileIcon,
  Link2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMessageStore } from '@/stores/useMessageStore';
import { EmojiPicker } from '@/components/ui/emoji-picker';
import { uploadFile, getUsers, type ApiFile, type AuthUser } from '@/lib/api';

interface MessageInputProps {
  channelId: number;
  channelName: string;
}

const formatButtons = [
  { icon: Bold, label: 'Bold', format: 'bold' },
  { icon: Italic, label: 'Italic', format: 'italic' },
  { icon: Strikethrough, label: 'Strikethrough', format: 'strike' },
  { icon: Link, label: 'Link', format: 'link' },
  { icon: ListOrdered, label: 'Ordered List', format: 'list', value: 'ordered' },
  { icon: List, label: 'Bullet List', format: 'list', value: 'bullet' },
  { icon: Code, label: 'Code', format: 'code' },
  { icon: CodeSquare, label: 'Code Block', format: 'code-block' },
  { icon: Quote, label: 'Quote', format: 'blockquote' },
];

export function MessageInput({ channelId, channelName }: MessageInputProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [canSend, setCanSend] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<ApiFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionUsers, setMentionUsers] = useState<AuthUser[]>([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const linkSavedRangeRef = useRef<{ index: number; length: number } | null>(null);
  const linkUrlInputRef = useRef<HTMLInputElement>(null);
  const mentionDropdownRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const { sendMessage } = useMessageStore();

  const serializeDelta = useCallback((quill: Quill): string => {
    const delta = quill.getContents();
    let result = '';
    let inCodeBlock = false;
    let codeBlockLines: string[] = [];

    const flushCodeBlock = () => {
      result += '```\n' + codeBlockLines.join('\n') + '\n```';
      codeBlockLines = [];
      inCodeBlock = false;
    };

    for (const op of delta.ops) {
      if (typeof op.insert !== 'string') continue;
      const attrs = op.attributes || {};
      const text = op.insert;

      if (attrs['code-block']) {
        // Quill emits code-block lines ending with '\n'
        const lines = text.split('\n');
        if (!inCodeBlock) inCodeBlock = true;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Last segment after final '\n' may be empty — signals end of block
          if (i === lines.length - 1 && line === '') {
            flushCodeBlock();
          } else {
            codeBlockLines.push(line);
          }
        }
      } else {
        if (inCodeBlock) flushCodeBlock();
        if (attrs['blockquote']) {
          // Prefix each line with '> '
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (i < lines.length - 1) {
              result += '> ' + line + '\n';
            } else if (line !== '') {
              result += '> ' + line;
            }
          }
        } else if (attrs['code']) {
          // Inline code: wrap in backticks
          result += '`' + text + '`';
        } else {
          result += text;
        }
      }
    }

    if (inCodeBlock) flushCodeBlock();

    return result.trim();
  }, []);

  const handleSend = useCallback(async () => {
    const quill = quillRef.current;
    if (!quill) return;
    const text = serializeDelta(quill);
    if (!text && pendingFiles.length === 0) return;
    const content = text || ' ';
    const fileIds = pendingFiles.map((f) => f.id);
    quill.setText('');
    setPendingFiles([]);
    setCanSend(false);
    await sendMessage(channelId, content, fileIds.length > 0 ? fileIds : undefined);
  }, [channelId, sendMessage, pendingFiles, serializeDelta]);

  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;
  const mentionActiveRef = useRef(false);
  mentionActiveRef.current = showMentionDropdown;

  useEffect(() => {
    if (!editorRef.current || quillRef.current) return;

    const quill = new Quill(editorRef.current, {
      theme: 'snow',
      modules: {
        toolbar: false,
        keyboard: {
          bindings: {
            enter: {
              key: 'Enter',
              handler: () => {
                // Don't send if mention dropdown is open
                if (mentionActiveRef.current) return true;
                handleSendRef.current();
                return false;
              },
            },
            escape: {
              key: 'Escape',
              handler: () => {
                if (mentionActiveRef.current) {
                  setShowMentionDropdown(false);
                  return false;
                }
                return true;
              },
            },
          },
        },
      },
      placeholder: `Message #${channelName}`,
    });

    quill.on('text-change', () => {
      setCanSend(quill.getText().trim().length > 0);
      // Detect @mention trigger
      const selection = quill.getSelection();
      if (!selection) return;
      const cursorPos = selection.index;
      const text = quill.getText(0, cursorPos);
      const atIndex = text.lastIndexOf('@');
      if (atIndex >= 0) {
        const beforeAt = atIndex > 0 ? text[atIndex - 1] : ' ';
        const query = text.slice(atIndex + 1);
        // Only trigger if @ is at start or preceded by whitespace, and query has no spaces
        if ((atIndex === 0 || /\s/.test(beforeAt)) && !/\s/.test(query)) {
          setMentionStartIndex(atIndex);
          setMentionQuery(query);
          setShowMentionDropdown(true);
          setMentionSelectedIndex(0);
          return;
        }
      }
      setShowMentionDropdown(false);
    });

    quillRef.current = quill;
  }, [channelName]);

  useEffect(() => {
    if (quillRef.current) {
      quillRef.current.root.dataset.placeholder = `Message #${channelName}`;
    }
  }, [channelName]);

  const handleEmojiSelect = useCallback((emoji: { native: string }) => {
    const quill = quillRef.current;
    if (!quill) return;
    const range = quill.getSelection(true);
    quill.insertText(range.index, emoji.native);
    quill.setSelection(range.index + emoji.native.length);
    setShowEmojiPicker(false);
    quill.focus();
  }, []);

  // Fetch users for mention autocomplete
  useEffect(() => {
    if (!showMentionDropdown) {
      setMentionUsers([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const users = await getUsers(mentionQuery || undefined);
        if (!cancelled) setMentionUsers(users);
      } catch {
        // ignore
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [showMentionDropdown, mentionQuery]);

  const insertMention = useCallback((user: AuthUser) => {
    const quill = quillRef.current;
    if (!quill || mentionStartIndex === null) return;
    const mentionText = `@${user.name}`;
    // Delete the @query text and insert mention
    const deleteLength = mentionQuery.length + 1; // +1 for @
    quill.deleteText(mentionStartIndex, deleteLength);
    quill.insertText(mentionStartIndex, mentionText + ' ');
    quill.setSelection(mentionStartIndex + mentionText.length + 1);
    setShowMentionDropdown(false);
    setMentionQuery('');
    setMentionStartIndex(null);
    quill.focus();
  }, [mentionStartIndex, mentionQuery]);

  const handleMentionButtonClick = () => {
    const quill = quillRef.current;
    if (!quill) return;
    const range = quill.getSelection(true);
    quill.insertText(range.index, '@');
    quill.setSelection(range.index + 1);
    quill.focus();
  };

  const handleLinkSave = useCallback(() => {
    const quill = quillRef.current;
    const range = linkSavedRangeRef.current;
    if (!quill || !linkUrl.trim()) {
      setShowLinkModal(false);
      return;
    }
    const url = linkUrl.trim().startsWith('http') ? linkUrl.trim() : `https://${linkUrl.trim()}`;
    if (range && range.length > 0) {
      // Apply link to existing selection
      quill.formatText(range.index, range.length, 'link', url);
    } else {
      // Insert new linked text at cursor
      const insertText = linkText.trim() || url;
      const insertAt = range ? range.index : quill.getLength() - 1;
      quill.insertText(insertAt, insertText, 'link', url);
      quill.setSelection(insertAt + insertText.length);
    }
    setShowLinkModal(false);
    setLinkUrl('');
    setLinkText('');
    linkSavedRangeRef.current = null;
    quill.focus();
  }, [linkUrl, linkText]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        const uploaded = await uploadFile(file);
        setPendingFiles((prev) => [...prev, uploaded]);
      }
    } catch (err) {
      console.error('Failed to upload file:', err);
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removePendingFile = (fileId: number) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  const applyFormat = (format: string, value?: string) => {
    const quill = quillRef.current;
    if (!quill) return;

    if (format === 'link') {
      const range = quill.getSelection();
      if (range) {
        const currentFormat = quill.getFormat(range);
        if (currentFormat.link) {
          quill.format('link', false);
        } else {
          // Save the selection range so we can apply the link after modal closes
          linkSavedRangeRef.current = { index: range.index, length: range.length };
          // Pre-fill display text from selected text
          const selectedText = range.length > 0 ? quill.getText(range.index, range.length) : '';
          setLinkText(selectedText);
          setLinkUrl('');
          setShowLinkModal(true);
          // Focus the URL input after modal renders
          setTimeout(() => linkUrlInputRef.current?.focus(), 50);
        }
      }
      return;
    }

    if (value) {
      const range = quill.getSelection();
      if (range) {
        const currentFormat = quill.getFormat(range);
        quill.format(format, currentFormat[format] === value ? false : value);
      }
    } else {
      const range = quill.getSelection();
      if (range) {
        const currentFormat = quill.getFormat(range);
        quill.format(format, !currentFormat[format]);
      }
    }
    quill.focus();
  };

  const hasContent = canSend || pendingFiles.length > 0;

  return (
    <div className="relative px-5 pb-6 pt-4 bg-white">
      <div className="slawk-editor rounded-[8px] border border-[rgba(29,28,29,0.13)]">
        {/* Formatting Toolbar — at the top inside the input box */}
        <div
          data-testid="formatting-toolbar"
          className="flex items-center gap-0.5 border-b border-[rgba(29,28,29,0.13)] px-1 py-1"
        >
          {formatButtons.map((button) => (
            <button
              key={button.label}
              onClick={() => applyFormat(button.format, button.value)}
              className="flex h-7 w-7 items-center justify-center rounded text-[#616061] hover:bg-[#F8F8F8] hover:text-[#1D1C1D]"
              title={button.label}
            >
              <button.icon className="h-[18px] w-[18px]" />
            </button>
          ))}
        </div>

        {/* File preview area */}
        {pendingFiles.length > 0 && (
          <div data-testid="file-preview" className="flex flex-wrap gap-2 px-3 py-2 border-b border-[rgba(29,28,29,0.13)]">
            {pendingFiles.map((file) => (
              <div
                key={file.id}
                className="relative flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
              >
                {file.mimetype.startsWith('image/') ? (
                  <img
                    src={file.url}
                    alt={file.originalName}
                    className="h-10 w-10 rounded object-cover"
                  />
                ) : (
                  <FileIcon className="h-5 w-5 text-gray-500" />
                )}
                <span className="max-w-[120px] truncate text-[13px] text-[#1D1C1D]">
                  {file.originalName}
                </span>
                <button
                  onClick={() => removePendingFile(file.id)}
                  className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 hover:bg-gray-300"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Upload progress indicator */}
        {isUploading && (
          <div className="px-3 py-1 text-xs text-gray-500">Uploading...</div>
        )}

        {/* Quill Editor */}
        <div ref={editorRef} />

        {/* Mention Dropdown */}
        {showMentionDropdown && mentionUsers.length > 0 && (
          <div
            data-testid="mention-dropdown"
            ref={mentionDropdownRef}
            className="absolute bottom-full left-0 mb-1 w-[280px] max-h-[200px] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg z-50"
          >
            {mentionUsers.map((user, index) => (
              <button
                key={user.id}
                onClick={() => insertMention(user)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#1264A3] hover:text-white',
                  index === mentionSelectedIndex ? 'bg-[#1264A3] text-white' : 'text-[#1D1C1D]'
                )}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded bg-[#611f69] text-white text-xs font-medium flex-shrink-0">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <span className="truncate font-medium">{user.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Emoji Picker */}
        {showEmojiPicker && (
          <div className="absolute bottom-full left-0 mb-2 z-50">
            <EmojiPicker
              onEmojiSelect={handleEmojiSelect}
              onClickOutside={() => setShowEmojiPicker(false)}
            />
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,.pdf,.txt,.json,.zip"
          onChange={handleFileSelect}
        />

        {/* Bottom Toolbar */}
        <div className="flex items-center justify-between px-[6px] py-1">
          <div className="flex items-center">
            <button
              data-testid="attach-file-button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-7 w-7 items-center justify-center rounded text-[#616061] hover:bg-[#F8F8F8] hover:text-[#1D1C1D]"
              title="Attach file"
            >
              <Plus className="h-[18px] w-[18px]" />
            </button>
            <button
              ref={emojiButtonRef}
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="flex h-7 w-7 items-center justify-center rounded text-[#616061] hover:bg-[#F8F8F8] hover:text-[#1D1C1D]"
            >
              <Smile className="h-[18px] w-[18px]" />
            </button>
            <button
              data-testid="mention-button"
              onClick={handleMentionButtonClick}
              className="flex h-7 w-7 items-center justify-center rounded text-[#616061] hover:bg-[#F8F8F8] hover:text-[#1D1C1D]"
            >
              <AtSign className="h-[18px] w-[18px]" />
            </button>
          </div>

          <button
            onClick={handleSend}
            disabled={!hasContent}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded transition-colors',
              hasContent
                ? 'bg-[#007a5a] text-white hover:bg-[#005e46]'
                : 'text-gray-400'
            )}
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="mt-1 text-xs text-gray-500">
        <kbd className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium">
          Enter
        </kbd>{' '}
        to send,{' '}
        <kbd className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium">
          Shift + Enter
        </kbd>{' '}
        for new line
      </p>

      {/* Link Modal */}
      {showLinkModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowLinkModal(false);
              setLinkUrl('');
              setLinkText('');
            }
          }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" />

          {/* Modal panel */}
          <div className="relative z-10 w-[440px] rounded-xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[rgba(29,28,29,0.13)] px-5 py-4">
              <div className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-[#1264A3]" />
                <h2 className="text-[17px] font-bold text-[#1D1C1D]">Add link</h2>
              </div>
              <button
                onClick={() => {
                  setShowLinkModal(false);
                  setLinkUrl('');
                  setLinkText('');
                }}
                className="flex h-7 w-7 items-center justify-center rounded text-[#616061] hover:bg-[#F8F8F8] hover:text-[#1D1C1D]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-[#1D1C1D]">
                  URL
                </label>
                <input
                  ref={linkUrlInputRef}
                  data-testid="link-url-input"
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleLinkSave();
                    if (e.key === 'Escape') {
                      setShowLinkModal(false);
                      setLinkUrl('');
                      setLinkText('');
                    }
                  }}
                  placeholder="https://example.com"
                  className="h-9 w-full rounded-md border border-[rgba(29,28,29,0.3)] px-3 text-[14px] text-[#1D1C1D] placeholder-[#616061] outline-none focus:border-[#1264A3] focus:ring-1 focus:ring-[#1264A3]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-[#1D1C1D]">
                  Display text <span className="font-normal text-[#616061]">(optional)</span>
                </label>
                <input
                  data-testid="link-text-input"
                  type="text"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleLinkSave();
                    if (e.key === 'Escape') {
                      setShowLinkModal(false);
                      setLinkUrl('');
                      setLinkText('');
                    }
                  }}
                  placeholder="Link text"
                  className="h-9 w-full rounded-md border border-[rgba(29,28,29,0.3)] px-3 text-[14px] text-[#1D1C1D] placeholder-[#616061] outline-none focus:border-[#1264A3] focus:ring-1 focus:ring-[#1264A3]"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-[rgba(29,28,29,0.13)] px-5 py-3">
              <button
                onClick={() => {
                  setShowLinkModal(false);
                  setLinkUrl('');
                  setLinkText('');
                }}
                className="rounded-md border border-[rgba(29,28,29,0.3)] bg-white px-4 py-1.5 text-[14px] font-medium text-[#1D1C1D] hover:bg-[#F8F8F8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLinkSave}
                disabled={!linkUrl.trim()}
                className={cn(
                  'rounded-md px-4 py-1.5 text-[14px] font-medium text-white transition-colors',
                  linkUrl.trim()
                    ? 'bg-[#007a5a] hover:bg-[#005e46]'
                    : 'bg-gray-300 cursor-not-allowed'
                )}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
