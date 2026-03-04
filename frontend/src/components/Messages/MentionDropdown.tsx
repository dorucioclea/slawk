import { forwardRef, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import type { AuthUser } from '@/lib/api';

interface MentionDropdownProps {
  users: AuthUser[];
  selectedIndex: number;
  onSelect: (user: AuthUser) => void;
}

export const MentionDropdown = forwardRef<HTMLDivElement, MentionDropdownProps>(
  function MentionDropdown({ users, selectedIndex, onSelect }, ref) {
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    if (users.length === 0) return null;

    return (
      <div
        data-testid="mention-dropdown"
        ref={ref}
        className="absolute bottom-full left-0 mb-1 w-[280px] max-h-[200px] overflow-y-auto rounded-lg border border-slack-border bg-white shadow-lg z-50"
      >
        {users.map((user, index) => (
          <button
            key={user.id}
            ref={(el) => { itemRefs.current[index] = el; }}
            onClick={() => onSelect(user)}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slack-link hover:text-white',
              index === selectedIndex ? 'bg-slack-link text-white' : 'text-slack-primary',
            )}
          >
            <Avatar
              src={user.avatar ?? undefined}
              alt={user.name}
              fallback={user.name}
              size="sm"
              className="flex-shrink-0"
            />
            <span className="truncate font-medium">{user.name}</span>
          </button>
        ))}
      </div>
    );
  },
);
