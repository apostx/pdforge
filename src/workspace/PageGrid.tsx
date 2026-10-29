import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { memo, useMemo, useRef, type CSSProperties } from 'react';
import { useI18n } from '../i18n';
import { PageSurface } from '../page/PageSurface';
import type { Thumb } from '../pdf/thumbs';
import { Icon } from '../ui/Icon';
import { pageGeometry } from './geometry';
import type { ImagePageSize, PageItem, Source } from './types';
import type { Workspace } from './useWorkspace';

/** Pages are tinted by source file so merged documents stay easy to follow. */
const SOURCE_COLORS = 6;

interface PageCardProps {
  page: PageItem;
  thumb: Thumb | undefined;
  source: Source;
  imagePageSize: ImagePageSize;
  position: number;
  label: string;
  caption: string;
  colorIndex: number;
  selected: boolean;
  dispatch: Workspace['dispatch'];
  onEdit: (id: string) => void;
}

const PageCard = memo(function PageCard({
  page,
  thumb,
  source,
  imagePageSize,
  position,
  label,
  caption,
  colorIndex,
  selected,
  dispatch,
  onEdit,
}: PageCardProps) {
  const { t } = useI18n();
  const geometry = useMemo(() => pageGeometry(page, source, imagePageSize), [page, source, imagePageSize]);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    '--source-color': `var(--source-${colorIndex % SOURCE_COLORS})`,
  } as CSSProperties;

  const className = ['page-card', selected && 'page-card--selected', isDragging && 'page-card--dragging']
    .filter(Boolean)
    .join(' ');

  return (
    <li ref={setNodeRef} style={style} className={className}>
      <div
        ref={setActivatorNodeRef}
        className="page-card__preview"
        {...attributes}
        {...listeners}
        aria-label={label}
        onClick={(event) => dispatch({ type: 'select', id: page.id, range: event.shiftKey })}
        onDoubleClick={() => onEdit(page.id)}
      >
        <div className="page-card__frame">
          {thumb ? (
            <PageSurface geometry={geometry} backgroundUrl={thumb.url} overlays={page.overlays} />
          ) : (
            <span className="spinner" aria-hidden="true" />
          )}
        </div>
      </div>

      <div className="page-card__actions">
        <button
          type="button"
          className="icon-button"
          title={t.editPage}
          aria-label={`${t.editPage}: ${label}`}
          onClick={() => onEdit(page.id)}
        >
          <Icon name="pencil" size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          title={t.rotateLeft}
          aria-label={`${t.rotateLeft}: ${label}`}
          onClick={() => dispatch({ type: 'rotate', ids: [page.id], delta: -90 })}
        >
          <Icon name="rotateLeft" size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          title={t.rotateRight}
          aria-label={`${t.rotateRight}: ${label}`}
          onClick={() => dispatch({ type: 'rotate', ids: [page.id], delta: 90 })}
        >
          <Icon name="rotateRight" size={16} />
        </button>
        <button
          type="button"
          className="icon-button icon-button--danger"
          title={t.remove}
          aria-label={`${t.remove}: ${label}`}
          onClick={() => dispatch({ type: 'remove', ids: [page.id] })}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>

      <div className="page-card__footer">
        <input
          type="checkbox"
          checked={selected}
          aria-label={t.selectPage(label)}
          // React fires a checkbox's onChange from its click event, so Shift is available here
          onChange={(event) =>
            dispatch({ type: 'select', id: page.id, range: (event.nativeEvent as MouseEvent).shiftKey === true })
          }
        />
        <span className="page-card__position">{position}</span>
        <span className="page-card__caption" title={caption}>
          {caption}
        </span>
      </div>
    </li>
  );
});

export function PageGrid({ ws, onEdit }: { ws: Workspace; onEdit: (id: string) => void }) {
  const { t } = useI18n();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // press-and-hold on touch screens, so a normal swipe still scrolls the page
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = ws.pages.map((page) => page.id);
  const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;
  const sources = new Map(ws.sources.map((source, index) => [source.id, { source, index }]));

  // dnd-kit reports "over" right after pickup too; skip repeats so "picked up" isn't overwritten
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      lastOverId.current = active.id;
      return t.dndPickedUp(position(active.id));
    },
    onDragOver: ({ active, over }) => {
      if (!over || over.id === lastOverId.current) return undefined;
      lastOverId.current = over.id;
      return t.dndOver(position(active.id), position(over.id));
    },
    onDragEnd: ({ active, over }) =>
      over ? t.dndDropped(position(active.id), position(over.id)) : t.dndCancelled(position(active.id)),
    onDragCancel: ({ active }) => t.dndCancelled(position(active.id)),
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t.dndInstructions } }}
      onDragEnd={({ active, over }) => {
        if (over) ws.dispatch({ type: 'move', id: String(active.id), overId: String(over.id) });
      }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ol className="page-grid">
          {ws.pages.map((page, index) => {
            const { source, index: sourceIndex } = sources.get(page.sourceId)!;
            const isPdf = source.kind === 'pdf';
            return (
              <PageCard
                key={page.id}
                page={page}
                thumb={ws.thumbs.get(page.id)}
                source={source}
                imagePageSize={ws.imagePageSize}
                position={index + 1}
                label={isPdf ? t.pageLabel(source.name, page.pageIndex + 1) : source.name}
                caption={isPdf ? `${source.name} · ${page.pageIndex + 1}` : source.name}
                colorIndex={sourceIndex}
                selected={ws.selected.has(page.id)}
                dispatch={ws.dispatch}
                onEdit={onEdit}
              />
            );
          })}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
