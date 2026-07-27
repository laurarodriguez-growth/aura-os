import { Inbox } from 'lucide-react';

export default function EmptyState({ title = 'Todavía no hay información', text = 'Los datos aparecerán aquí cuando empieces a trabajar.' }) {
  return (
    <div className="empty-state">
      <Inbox size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
