// Shared Tailwind config for all pages.
// Loaded AFTER cdn.tailwindcss.com — extends the default theme so designs are
// consistent across login / accounts / explorer / api-keys / add.

tailwind.config = {
    theme: {
        extend: {
            colors: {
                primary: {
                    DEFAULT: "#0068ff",
                    50: "#eff5ff",
                    100: "#dbe7fe",
                    200: "#bfd5fe",
                    400: "#5e98fb",
                    500: "#3578f0",
                    600: "#0068ff",
                    700: "#0050c8",
                    800: "#0a3f8c",
                },
                accent: {
                    success: "#16a34a",
                    danger: "#dc2626",
                    warn: "#d97706",
                },
            },
            fontFamily: {
                sans: [
                    "-apple-system",
                    "BlinkMacSystemFont",
                    '"Segoe UI"',
                    "Roboto",
                    "system-ui",
                    "sans-serif",
                ],
                mono: ['ui-monospace', '"SF Mono"', "Menlo", "Consolas", "monospace"],
            },
            boxShadow: {
                card: "0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)",
                modal: "0 20px 60px rgba(15, 23, 42, 0.2)",
            },
            keyframes: {
                fadeIn: {
                    from: { opacity: "0", transform: "translateY(-4px)" },
                    to: { opacity: "1", transform: "translateY(0)" },
                },
            },
            animation: {
                fadeIn: "fadeIn 0.18s ease-out",
            },
        },
    },
};
