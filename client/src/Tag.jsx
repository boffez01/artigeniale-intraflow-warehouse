export default function Tag({ status }) {
  return <span className={`tag ${status}`}>{status.replace('_', ' ')}</span>;
}