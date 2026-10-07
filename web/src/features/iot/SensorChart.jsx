import { useMemo } from 'react'
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'
import annotationPlugin from 'chartjs-plugin-annotation'
import { Line } from 'react-chartjs-2'
import { SENSORS, annotationsFor, makeGradient, computeYMax } from './utils.js'

ChartJS.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
  annotationPlugin
)

ChartJS.defaults.color = '#aeaeb2'
ChartJS.defaults.font.family =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
ChartJS.defaults.font.size = 12

// 6 chart line dengan gradient/annotation ala index.html createChart (baris 459-498).
export default function SensorChart({ sensorKey, labels, values, height = 230 }) {
  const meta = SENSORS[sensorKey]

  const yMax = useMemo(() => computeYMax(values, meta), [values, meta])

  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data: values,
          borderColor: meta.color,
          backgroundColor: (context) => {
            const { ctx, chartArea } = context.chart
            return makeGradient(ctx, chartArea, meta.color)
          },
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.4,
          spanGaps: true,
        },
      ],
    }),
    [labels, values, meta.color]
  )

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        annotation: { annotations: annotationsFor(sensorKey) },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { maxTicksLimit: 7 },
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
          min: meta.yMin,
          max: yMax,
          beginAtZero: true,
        },
      },
      interaction: { mode: 'index', intersect: false },
    }),
    [sensorKey, meta.yMin, yMax]
  )

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <Line data={data} options={options} />
    </div>
  )
}
