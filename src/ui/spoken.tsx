export const Spoken = ({ shown, said }: { shown: string; said: string }) =>
  shown === said ? (
    shown
  ) : (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="visually-hidden">{said}</span>
    </>
  );
