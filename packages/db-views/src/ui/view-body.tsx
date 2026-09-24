import { BoardView } from './board/board-view';
import { CalendarView } from './calendar/calendar-view';
import type { ViewBodyProps } from './database-view';
import { GalleryView } from './gallery/gallery-view';
import { ListView } from './list/list-view';

/** The layouts other than the table (the table needs its grid height and is rendered directly). */
export function ViewBody(props: ViewBodyProps) {
  switch (props.view.type) {
    case 'board':
      return <BoardView {...props} />;
    case 'calendar':
      return <CalendarView {...props} />;
    case 'gallery':
      return <GalleryView {...props} />;
    case 'list':
      return <ListView {...props} />;
    case 'table':
      // Rendered by DatabaseView itself.
      return null;
  }
}
