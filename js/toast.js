// js/toast.js
// Simple toast notification system (Spanish friendly)

export function showToast(message, type = "info") {
  // type: "info", "success", "error", "warning"
  const toastContainerId = "toast-container";
  let container = document.getElementById(toastContainerId);
  if (!container) {
    container = document.createElement("div");
    container.id = toastContainerId;
    container.style.position = "fixed";
    container.style.top = "1rem";
    container.style.right = "1rem";
    container.style.zIndex = "9999";
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "0.5rem";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.minWidth = "200px";
  toast.style.padding = "0.75rem 1rem";
  toast.style.borderRadius = "0.5rem";
  toast.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
  toast.style.fontFamily = "inherit";
  toast.style.fontSize = "0.9rem";
  toast.style.color = "#fff";
  toast.style.opacity = "0";
  toast.style.transition = "opacity 0.3s ease";

  // Background based on type
  const bgMap = {
    info: "#2196F3",
    success: "#4CAF50",
    error: "#F44336",
    warning: "#FF9800"
  };
  toast.style.background = bgMap[type] || bgMap.info;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
  });

  // Auto dismiss after 4 seconds
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.addEventListener("transitionend", () => toast.remove());
  }, 4000);
}
