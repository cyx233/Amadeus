// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    dim: '\x1b[2m',
};

const c = {
    info: (text: string) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text: string) => `${colors.green}${text}${colors.reset}`,
    warn: (text: string) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text: string) => `${colors.blue}${text}${colors.reset}`,
    bright: (text: string) => `${colors.bright}${text}${colors.reset}`,
    dim: (text: string) => `${colors.dim}${text}${colors.reset}`,
};

export { colors, c };
