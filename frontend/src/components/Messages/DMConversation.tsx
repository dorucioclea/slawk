import { useState, useEffect, useRef, useCallback } from 'react';
import { format, isToday, isYesterday } from 'date-fns';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import {
  SendHorizontal,
  Plus,
  Smile,
  AtSign,
  Pin,
  FileText,
  X,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { EmojiPicker } from '@/components/ui/emoji-picker';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDMStore } from '@/stores/useDMStore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useMessageHover } from '@/hooks/useMessageHover';
import { useMessageEdit } from '@/hooks/useMessageEdit';
import { MessageToolbar } from './MessageToolbar';
import { MessageActionsMenu } from './MessageActionsMenu';
import { FormatToolbar } from './FormatToolbar';
import { renderMessageContent } from '@/lib/renderMessageContent';
import type { DMMessage } from '@/stores/useDMStore';

interface DMConversationProps {
  userId: number;
  userName: string;
  userAvatar?: string;
}

function formatDateSeparator(date: Date): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, MMMM d');
}

const dmHeaderTabs = [
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'pins', label: 'Pins', icon: Pin },
];

const EMPTY_MESSAGES: DMMessage[] = [];

export function DMConversation({ userId, userName, userAvatar }: DMConversationProps) {
  const messages = useDMStore((s) => s.messages[userId]) ?? EMPTY_MESSAGES;
  const isLoading = useDMStore((s) => s.isLoading);
  const loadError = useDMStore((s) => s.loadError);
  const isSending = useDMStore((s) => s.isSending);
  const fetchConversation = useDMStore((s) => s.fetchConversation);
  const sendError = useDMStore((s) => s.sendError);
  const clearSendError = useDMStore((s) => s.clearSendError);
  const storeSendMessage = useDMStore((s) => s.sendMessage);
  const storeEditMessage = useDMStore((s) => s.editMessage);
  const storeDeleteMessage = useDMStore((s) => s.deleteMessage);

  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const [canSend, setCanSend] = useState(false);
  const [showInputEmojiPicker, setShowInputEmojiPicker] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<number | null>(null);
  const [showMoreMenuId, setShowMoreMenuId] = useState<number | null>(null);
  const [showEmojiPickerId, setShowEmojiPickerId] = useState<number | null>(null);
  const [showPins, setShowPins] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hoverLeaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const currentUser = useAuthStore((s) => s.user);
  const {
    editingId, editContent, setEditContent, editInputRef,
    startEdit, cancelEdit, saveEdit, handleEditKeyDown,
  } = useMessageEdit({
    onSave: (id, content) => storeEditMessage(id, content, userId),
  });

  useEffect(() => {
    fetchConversation(userId);
  }, [userId, fetchConversation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

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
        const lines = text.split('\n');
        if (!inCodeBlock) inCodeBlock = true;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (i === lines.length - 1 && line === '') {
            flushCodeBlock();
          } else {
            codeBlockLines.push(line);
          }
        }
      } else {
        if (inCodeBlock) flushCodeBlock();
        if (attrs['blockquote']) {
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
    if (!text || isSending) return;

    quill.setText('');
    setCanSend(false);
    await storeSendMessage(userId, text);
  }, [userId, isSending, storeSendMessage, serializeDelta]);

  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

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
                handleSendRef.current();
                return false;
              },
            },
          },
        },
      },
      placeholder: `Message ${userName}`,
    });

    quill.on('text-change', () => {
      setCanSend(quill.getText().trim().length > 0);
    });

    // Set test ID on the editable element for Playwright compatibility
    quill.root.setAttribute('data-testid', 'dm-message-input');

    quillRef.current = quill;
  }, [userName]);

  useEffect(() => {
    if (quillRef.current) {
      quillRef.current.root.dataset.placeholder = `Message ${userName}`;
    }
  }, [userName]);

  const applyFormat = (format: string, value?: string) => {
    const quill = quillRef.current;
    if (!quill) return;
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

  const handleInputEmojiSelect = useCallback((emoji: { native: string }) => {
    const quill = quillRef.current;
    if (!quill) return;
    const range = quill.getSelection(true);
    quill.insertText(range.index, emoji.native);
    quill.setSelection(range.index + emoji.native.length);
    setShowInputEmojiPicker(false);
    quill.focus();
  }, []);

  const handleMentionButtonClick = () => {
    const quill = quillRef.current;
    if (!quill) return;
    const range = quill.getSelection(true);
    quill.insertText(range.index, '@');
    quill.setSelection(range.index + 1);
    quill.focus();
  };

  const handleStartEdit = (msg: { id: number; content: string }) => {
    startEdit(msg.id, msg.content);
    setShowMoreMenuId(null);
  };

  const handleDelete = async (msgId: number) => {
    setShowMoreMenuId(null);
    await storeDeleteMessage(msgId, userId);
  };

  const keepToolbarOpen = (msgId: number) =>
    showMoreMenuId === msgId || showEmojiPickerId === msgId || editingId === msgId;

  return (
    <div data-testid="dm-conversation" className="flex h-full flex-col">
      {/* Header */}
      <header className="flex flex-col border-b border-slack-border bg-white">
        {/* Top Row */}
        <div className="flex h-[49px] items-center px-4">
          <Avatar
            src={userAvatar || undefined}
            alt={userName}
            fallback={userName}
            size="md"
            status="online"
          />
          <span className="ml-2 text-[18px] font-bold text-slack-primary">{userName}</span>
        </div>
        {/* Tabs Row */}
        <div className="flex items-center gap-0.5 px-4 pb-[6px]">
          {dmHeaderTabs.map((tab) => (
            <button
              key={tab.id}
              data-testid={`dm-header-tab-${tab.id}`}
              onClick={() => {
                if (tab.id === 'pins') {
                  setShowPins((prev) => !prev);
                  setShowFiles(false);
                } else if (tab.id === 'files') {
                  setShowFiles((prev) => !prev);
                  setShowPins(false);
                }
              }}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-[3px] text-[13px] transition-colors',
                (tab.id === 'pins' && showPins) || (tab.id === 'files' && showFiles)
                  ? 'bg-slack-active-tab text-slack-primary font-medium'
                  : 'text-slack-secondary hover:bg-slack-hover hover:text-slack-primary',
              )}
            >
              <tab.icon className="h-[14px] w-[14px]" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Body: messages column + optional side panel */}
      <div className="flex min-h-0 flex-1">
        {/* Messages column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Messages list */}
          <div className="flex-1 overflow-y-auto bg-white px-5 pb-4 pt-5">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slack-hint">
                Loading messages...
              </div>
            ) : loadError ? (
              <div className="flex h-full items-center justify-center text-sm text-slack-error">
                {loadError}
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-slack-hint">
                <p className="text-lg font-medium">
                  Start of your conversation with {userName}
                </p>
                <p className="text-sm">Send a message to begin.</p>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => {
                  const prevMsg = messages[i - 1];
                  const showDate =
                    !prevMsg ||
                    (!isToday(prevMsg.createdAt) &&
                      format(msg.createdAt, 'yyyy-MM-dd') !==
                        format(prevMsg.createdAt, 'yyyy-MM-dd'));
                  const showAvatar = !prevMsg || prevMsg.fromUserId !== msg.fromUserId;
                  const isOwner = currentUser?.id === msg.fromUserId;
                  const isHovered = hoveredMessageId === msg.id;
                  const isEditing = editingId === msg.id;

                  return (
                    <div key={msg.id}>
                      {showDate && (
                        <div className="relative my-[10px] flex items-center">
                          <div className="flex-1 border-t border-slack-border-light" />
                          <span className="flex-shrink-0 rounded-full border border-slack-border-light bg-white px-3 py-[2px] text-[13px] font-semibold text-slack-primary">
                            {formatDateSeparator(msg.createdAt)}
                          </span>
                          <div className="flex-1 border-t border-slack-border-light" />
                        </div>
                      )}
                      <div
                        className={cn(
                          'group relative flex px-0 hover:bg-slack-hover',
                          showAvatar ? 'pb-2 pt-4' : 'py-0.5',
                        )}
                        onMouseEnter={() => {
                          clearTimeout(hoverLeaveTimer.current);
                          setHoveredMessageId(msg.id);
                        }}
                        onMouseLeave={() => {
                          hoverLeaveTimer.current = setTimeout(() => {
                            setHoveredMessageId(null);
                            setShowMoreMenuId(null);
                          }, 150);
                        }}
                      >
                        <div className="mr-2 w-9 flex-shrink-0">
                          {showAvatar ? (
                            <Avatar
                              src={msg.fromUser.avatar || undefined}
                              alt={msg.fromUser.name}
                              fallback={msg.fromUser.name}
                              size="md"
                              className="mt-[5px]"
                            />
                          ) : (
                            <span className="hidden text-[12px] leading-[22px] text-slack-secondary group-hover:inline">
                              {format(msg.createdAt, 'h:mm')}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          {showAvatar && (
                            <div className="flex items-baseline gap-2">
                              <span className="text-[15px] font-black text-slack-primary">
                                {msg.fromUser.name}
                              </span>
                              <span className="text-[12px] text-slack-secondary">
                                {format(msg.createdAt, 'h:mm a')}
                              </span>
                              {msg.editedAt && (
                                <span className="text-[12px] text-slack-secondary">(edited)</span>
                              )}
                            </div>
                          )}
                          {isEditing ? (
                            <div className="mt-1">
                              <textarea
                                ref={editInputRef}
                                data-testid="dm-edit-input"
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                onKeyDown={(e) => handleEditKeyDown(e, msg.content)}
                                className="w-full resize-none rounded border border-slack-link bg-white p-2 text-[15px] leading-[22px] text-slack-primary outline-none"
                                rows={2}
                              />
                              <div className="mt-1 flex items-center gap-2 text-[12px]">
                                <button
                                  onClick={cancelEdit}
                                  className="text-slack-secondary hover:underline"
                                >
                                  Cancel
                                </button>
                                <button
                                  data-testid="dm-edit-save"
                                  onClick={() => saveEdit(msg.content)}
                                  className="rounded bg-slack-btn px-3 py-1 text-white hover:bg-slack-btn-hover"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="whitespace-pre-wrap break-words text-[15px] leading-[22px] text-slack-primary">
                              {renderMessageContent(msg.content)}
                              {!showAvatar && msg.editedAt && (
                                <span className="ml-1 text-[12px] text-slack-secondary">(edited)</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Hover action toolbar */}
                        {(isHovered || keepToolbarOpen(msg.id)) && !isEditing && (
                          <MessageToolbar
                            className="absolute -top-4 right-2"
                            testIdPrefix="dm"
                            onEmojiClick={() =>
                              setShowEmojiPickerId((prev) =>
                                prev === msg.id ? null : msg.id,
                              )
                            }
                            onThreadClick={() => {
                              // Threads on DMs not supported yet
                            }}
                            onMoreClick={() =>
                              setShowMoreMenuId((prev) =>
                                prev === msg.id ? null : msg.id,
                              )
                            }
                          />
                        )}

                        {/* More actions dropdown */}
                        {showMoreMenuId === msg.id && (
                          <MessageActionsMenu
                            className="absolute -top-4 right-2 z-50 mt-9"
                            testIdPrefix="dm"
                            showOwnerActions={isOwner}
                            onEdit={() => handleStartEdit(msg)}
                            onDelete={() => handleDelete(msg.id)}
                          />
                        )}

                        {/* Emoji picker */}
                        {showEmojiPickerId === msg.id && (
                          <div className="absolute -top-4 right-2 z-50 mt-9">
                            <EmojiPicker
                              onEmojiSelect={(_emoji) => {
                                // Reactions on DMs not supported by backend yet
                                setShowEmojiPickerId(null);
                              }}
                              onClickOutside={() => setShowEmojiPickerId(null)}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          <div className="relative bg-white px-5 pb-6 pt-4">
            <div className="slawk-editor rounded-[8px] border border-slack-border-light">
              {/* Formatting Toolbar */}
              <FormatToolbar onApplyFormat={applyFormat} />

              {/* Quill Editor */}
              <div ref={editorRef} />

              {/* Emoji Picker */}
              {showInputEmojiPicker && (
                <div className="absolute bottom-full left-0 mb-2 z-50">
                  <EmojiPicker
                    onEmojiSelect={handleInputEmojiSelect}
                    onClickOutside={() => setShowInputEmojiPicker(false)}
                  />
                </div>
              )}

              {/* Bottom Toolbar */}
              <div className="flex items-center justify-between px-[6px] py-1">
                <div className="flex items-center">
                  <Button variant="toolbar" size="icon-sm" title="Attach file">
                    <Plus className="h-[18px] w-[18px]" />
                  </Button>
                  <Button
                    variant="toolbar"
                    size="icon-sm"
                    onClick={() => setShowInputEmojiPicker(!showInputEmojiPicker)}
                  >
                    <Smile className="h-[18px] w-[18px]" />
                  </Button>
                  <Button variant="toolbar" size="icon-sm" onClick={handleMentionButtonClick}>
                    <AtSign className="h-[18px] w-[18px]" />
                  </Button>
                </div>
                <button
                  data-testid="dm-send-button"
                  onClick={handleSend}
                  disabled={!canSend || isSending}
                  className={cn(
                    'flex h-7 items-center justify-center rounded px-2 transition-colors',
                    canSend
                      ? 'bg-slack-btn text-white hover:bg-slack-btn-hover'
                      : 'text-slack-disabled',
                  )}
                >
                  <SendHorizontal className="h-4 w-4" />
                </button>
              </div>
            </div>

            <p className="mt-1 text-xs text-slack-hint">
              <kbd className="rounded bg-slack-active-tab px-1 py-0.5 text-[10px] font-medium">Enter</kbd>{' '}
              to send,{' '}
              <kbd className="rounded bg-slack-active-tab px-1 py-0.5 text-[10px] font-medium">
                Shift + Enter
              </kbd>{' '}
              for new line
            </p>

            {sendError && (
              <div className="mt-2 flex items-center justify-between rounded-md bg-slack-error-bg border border-slack-error-border px-3 py-2 text-[13px] text-slack-error">
                <span>{sendError}</span>
                <button onClick={clearSendError} className="ml-2 text-red-500 hover:text-slack-error">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Pins Panel */}
        {showPins && (
          <div
            data-testid="dm-pins-panel"
            className="flex w-[300px] flex-col border-l border-slack-border bg-white"
          >
            <div className="flex h-[49px] items-center justify-between border-b border-slack-border px-4">
              <div className="flex items-center gap-1.5">
                <Pin className="h-4 w-4 text-slack-secondary" />
                <span className="text-[15px] font-bold text-slack-primary">Pinned messages</span>
              </div>
              <Button
                variant="toolbar"
                size="icon-sm"
                onClick={() => setShowPins(false)}
              >
                <X className="h-4 w-4 text-slack-secondary" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 text-center text-sm text-slack-hint">
              No pinned messages yet
            </div>
          </div>
        )}

        {/* Files Panel */}
        {showFiles && (
          <div
            data-testid="dm-files-panel"
            className="flex w-[300px] flex-col border-l border-slack-border bg-white"
          >
            <div className="flex h-[49px] items-center justify-between border-b border-slack-border px-4">
              <div className="flex items-center gap-1.5">
                <FileText className="h-4 w-4 text-slack-secondary" />
                <span className="text-[15px] font-bold text-slack-primary">Files</span>
              </div>
              <Button
                variant="toolbar"
                size="icon-sm"
                onClick={() => setShowFiles(false)}
              >
                <X className="h-4 w-4 text-slack-secondary" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 text-center text-sm text-slack-hint">
              No files shared yet
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
