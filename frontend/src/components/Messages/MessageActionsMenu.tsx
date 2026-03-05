import { Pin, Pencil, Trash2, MailOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface MessageActionsMenuProps {
  onPin?: () => void;
  isPinned?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onMarkUnread?: () => void;
  showOwnerActions: boolean;
  className?: string;
  testIdPrefix?: string;
}

export function MessageActionsMenu({
  onPin,
  isPinned,
  onEdit,
  onDelete,
  onMarkUnread,
  showOwnerActions,
  className,
  testIdPrefix,
}: MessageActionsMenuProps) {
  const hasAnyAction = onPin || showOwnerActions || onMarkUnread;

  if (!hasAnyAction) {
    return (
      <div
        data-testid={testIdPrefix ? `${testIdPrefix}-more-menu` : undefined}
        className={cn(
          'w-48 rounded-lg border border-slack-border bg-white py-1 shadow-lg',
          className,
        )}
      >
        <div className="px-4 py-1.5 text-[13px] text-slack-secondary">
          No actions available
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={testIdPrefix ? `${testIdPrefix}-more-menu` : undefined}
      className={cn(
        'w-48 rounded-lg border border-slack-border bg-white py-1 shadow-lg',
        className,
      )}
    >
      {onMarkUnread && (
        <Button variant="menu-item" onClick={onMarkUnread}>
          <MailOpen className="h-4 w-4" />
          Mark as unread
        </Button>
      )}
      {onPin && (
        <Button variant="menu-item" onClick={onPin}>
          <Pin className="h-4 w-4" />
          {isPinned ? 'Unpin message' : 'Pin message'}
        </Button>
      )}
      {showOwnerActions && onEdit && (
        <Button
          variant="menu-item"
          data-testid={testIdPrefix ? `${testIdPrefix}-edit-btn` : undefined}
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
          Edit message
        </Button>
      )}
      {showOwnerActions && onDelete && (
        <Button
          variant="menu-item-danger"
          data-testid={testIdPrefix ? `${testIdPrefix}-delete-btn` : undefined}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
          Delete message
        </Button>
      )}
    </div>
  );
}
