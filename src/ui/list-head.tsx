import { Icon } from "./icons.tsx";
import { Title } from "./title.tsx";

export function ListHead({ title, add, onAdd }: { title: string; add: string; onAdd: () => void }) {
  return (
    <div className="lib-head">
      <Title>{title}</Title>
      <button type="button" onClick={onAdd}>
        <Icon name="plus" />
        {add}
      </button>
    </div>
  );
}
