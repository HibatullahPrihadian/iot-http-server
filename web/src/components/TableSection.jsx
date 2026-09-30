import PipeTube from './PipeTube.jsx'

// Satu meja = 6 pipa PVC.
export default function TableSection({
  tableNumber,
  batches,
  onPipeClick,
  onHistoryClick,
}) {
  const pipes = Array.from({ length: 6 }, (_, i) => i + 1)

  return (
    <section className="glass-panel p-5">
      <h2 className="text-lg font-bold text-text-hi mb-4">Meja {tableNumber}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {pipes.map((pipeNumber) => (
          <PipeTube
            key={pipeNumber}
            tableNumber={tableNumber}
            pipeNumber={pipeNumber}
            batch={batches[pipeNumber] || null}
            onClick={onPipeClick}
            onHistoryClick={onHistoryClick}
          />
        ))}
      </div>
    </section>
  )
}
