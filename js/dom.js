export function element(tag, className, label) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (label != null) node.textContent = label;
  return node;
}
