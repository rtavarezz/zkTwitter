# Circuit Installation Guide

## Prerequisites

### 1. Install Circom Compiler

**macOS (using Homebrew):**
```bash
brew install circom
```

**Manual Installation (any OS):**
```bash
# Download latest release (v2.1.5+)
curl -L https://github.com/iden3/circom/releases/latest/download/circom-macos-amd64 -o circom
chmod +x circom
sudo mv circom /usr/local/bin/
```

**Verify installation:**
```bash
circom --version
```

### 2. Install snarkjs

Already installed via npm, but you can install globally:
```bash
npm install -g snarkjs
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Compile circuit
npm run compile

# 3. Run trusted setup (downloads 200MB powers of tau file)
npm run setup

# 4. Build witness input from latest Self proof
npm run build-input

# 5. Generate and verify proof
npm run prove
```

## Troubleshooting

**Error: `circom: command not found`**
- Install circom following steps above
- Ensure `/usr/local/bin` is in your PATH

**Error: `Cannot find module 'circomlib'`**
- Run `npm install` in the circuits directory

**Error: `No witness files found`**
- First generate a Self proof in the server:
  ```bash
  cd ../server
  npm run build-generation-witness
  ```

## Development Workflow

1. **Modify circuit** → Edit `.circom` files
2. **Recompile** → `npm run compile`
3. **Generate new witness** → `npm run build-input`
4. **Test proof** → `npm run prove`

## File Structure

```
circuits/
├── generation/           # Main circuit files
│   ├── generationMembership.circom
│   ├── generationConfig.circom
│   └── birthYearParser.circom
├── primitives/          # Reusable components
│   ├── poseidon.circom
│   └── comparators.circom
├── scripts/             # Build scripts
│   ├── compile.sh
│   ├── setup.sh
│   ├── prove.sh
│   └── buildWitness.mjs
└── build/               # Generated files (gitignored)
    ├── generationMembership.r1cs
    ├── generationMembership_final.zkey
    ├── verification_key.json
    ├── proof.json
    └── public.json
```
