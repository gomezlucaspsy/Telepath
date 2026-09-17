export function telepathIconElement(size: number) {
  const ringStyle = (scale: number, opacity: number) => ({
    position: "absolute" as const,
    width: size * scale,
    height: size * scale,
    borderRadius: "50%",
    border: `${Math.max(1, Math.round(size * 0.02))}px solid rgba(255,255,255,${opacity})`,
  });

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #3B82F6 0%, #EC4899 100%)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: size * 0.62,
          height: size * 0.62,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={ringStyle(1, 0.55)} />
        <div style={ringStyle(0.66, 0.85)} />
        <div
          style={{
            width: size * 0.17,
            height: size * 0.17,
            borderRadius: "50%",
            background: "white",
          }}
        />
      </div>
    </div>
  );
}
