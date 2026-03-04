import { useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMessageStore } from '@/stores/useMessageStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { EmojiPicker } from '@/components/ui/emoji-picker';
import type { Reaction } from '@/lib/types';
import data from '@emoji-mart/data';

const SHORTCODE_ALIASES: Record<string, string> = {
  mind_blown: 'exploding_head',
};

function shortcodeToNative(emoji: string): string {
  const key = SHORTCODE_ALIASES[emoji] ?? emoji;
  const emojiData = (data as any).emojis?.[key];
  if (emojiData?.skins?.[0]?.native) return emojiData.skins[0].native;
  return emoji;
}

interface MessageReactionsProps {
  reactions: Reaction[];
  messageId: number;
}

export function MessageReactions({ reactions, messageId }: MessageReactionsProps) {
  const { addReaction, removeReaction } = useMessageStore();
  const user = useAuthStore((s) => s.user);
  const [showPicker, setShowPicker] = useState(false);
  const currentUserId = user?.id ?? -1;

  const handleReactionClick = (emoji: string, hasReacted: boolean) => {
    if (hasReacted) {
      removeReaction(messageId, emoji);
    } else {
      addReaction(messageId, emoji);
    }
  };

  const handleEmojiSelect = (emoji: { native: string }) => {
    addReaction(messageId, emoji.native);
    setShowPicker(false);
  };

  return (
    <div className="relative mt-[6px] inline-flex flex-wrap items-center gap-[4px]">
      {reactions.map((reaction) => {
        const hasReacted = reaction.userIds.includes(currentUserId);
        return (
          <button
            key={reaction.emoji}
            onClick={() => handleReactionClick(reaction.emoji, hasReacted)}
            className={cn(
              'inline-flex h-[22px] items-center gap-1 rounded-[12px] border px-[6px] text-[12px] transition-colors',
              hasReacted
                ? 'border-slack-link bg-slack-highlight text-slack-link'
                : 'border-slack-border bg-white text-slack-primary hover:bg-slack-hover'
            )}
          >
            <span data-testid="reaction-emoji" className="text-sm leading-none">{shortcodeToNative(reaction.emoji)}</span>
            <span className="text-[13px] font-medium">{reaction.count}</span>
          </button>
        );
      })}
      <button
        onClick={() => setShowPicker(!showPicker)}
        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[12px] border border-slack-border bg-white text-slack-secondary hover:bg-slack-hover"
      >
        <Plus className="h-[12px] w-[12px]" />
      </button>
      {showPicker && (
        <div className="absolute bottom-full left-0 mb-2 z-50">
          <EmojiPicker
            onEmojiSelect={handleEmojiSelect}
            onClickOutside={() => setShowPicker(false)}
          />
        </div>
      )}
    </div>
  );
}
