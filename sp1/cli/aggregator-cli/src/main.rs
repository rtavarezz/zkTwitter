use std::{fs, path::PathBuf};

use anyhow::Context;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use clap::{Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};
use sp1_prover::components::CpuProverComponents;
use sp1_sdk::{include_elf, utils, HashableKey, Prover, ProverClient, SP1Stdin};

const ELF: &[u8] = include_elf!("aggregator");

#[derive(Parser)]
#[command(author, version, about = "SP1 aggregator helper for zkTwitter")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Runs the program locally (no proof) to check validity of the inputs.
    Execute {
        #[arg(value_name = "JSON")]
        input: PathBuf,
    },
    /// Requests a proof either locally or via the prover network.
    Prove {
        #[arg(value_name = "JSON")]
        input: PathBuf,
        #[arg(long, default_value = "local")]
        network: ProverNetwork,
        #[arg(long, default_value = "compressed")]
        proof: ProofMode,
    },
}

#[derive(Clone, Copy, ValueEnum)]
enum ProverNetwork {
    Local,
    Reserved,
    Mainnet,
}

#[derive(Clone, Copy, ValueEnum)]
enum ProofMode {
    Core,
    Compressed,
    Groth16,
    Plonk,
}

#[derive(Serialize)]
struct ProverResponse {
    proof: String,
    public_values: String,
    vk_hash: String,
    metadata: AggregatedMetadata,
}

#[derive(Serialize)]
struct AggregatedMetadata {
    self_nullifier: String,
    generation_id: u32,
    social_level: u32,
    claim_hash: String,
}

#[derive(Deserialize, Serialize)]
struct AggregationInput {
    generation: serde_json::Value,
    social: serde_json::Value,
    session_nonce: String,
    verified_root: String,
    min_verified_needed: u32,
    target_generation_id: u32,
    self_nullifier: String,
    generation_claim_hash: String,
    social_claim_hash: String,
}

fn main() -> anyhow::Result<()> {
    utils::setup_logger();
    let cli = Cli::parse();

    match cli.command {
        Commands::Execute { input } => execute_only(input),
        Commands::Prove {
            input,
            network,
            proof,
        } => prove(input, network, proof),
    }
}

#[derive(Deserialize, Serialize)]
struct ZkVmInput {
    generation: ZkVmGroth16,
    social: ZkVmGroth16,
    session_nonce: String,
    verified_root: String,
    min_verified_needed: u32,
    target_generation_id: u32,
    self_nullifier: String,
    generation_claim_hash: String,
    social_claim_hash: String,
}

#[derive(Deserialize, Serialize)]
struct ZkVmGroth16 {
    proof: String,
    public_signals: Vec<String>,
}

// Reads the JSON from the server and converts it to zkVM stdin format
fn build_stdin(path: PathBuf) -> anyhow::Result<(SP1Stdin, AggregationInput)> {
    let raw = fs::read(&path)
        .with_context(|| format!("Failed to read input file {}", path.display()))?;
    let payload: AggregationInput = serde_json::from_slice(&raw)
        .with_context(|| format!("Invalid aggregator payload {}", path.display()))?;

    eprintln!("CLI successfully parsed JSON. Self nullifier: {}", payload.self_nullifier);

    // Convert to what the zkVM expects (proofs as strings + metadata)
    let zkvm_input = ZkVmInput {
        generation: ZkVmGroth16 {
            proof: payload.generation.to_string(),
            public_signals: serde_json::from_value(payload.generation.get("publicSignals").cloned().unwrap_or_default())?,
        },
        social: ZkVmGroth16 {
            proof: payload.social.to_string(),
            public_signals: serde_json::from_value(payload.social.get("publicSignals").cloned().unwrap_or_default())?,
        },
        session_nonce: payload.session_nonce.clone(),
        verified_root: payload.verified_root.clone(),
        min_verified_needed: payload.min_verified_needed,
        target_generation_id: payload.target_generation_id,
        self_nullifier: payload.self_nullifier.clone(),
        generation_claim_hash: payload.generation_claim_hash.clone(),
        social_claim_hash: payload.social_claim_hash.clone(),
    };

    let mut stdin = SP1Stdin::new();
    stdin.write(&zkvm_input);
    Ok((stdin, payload))
}

fn execute_only(path: PathBuf) -> anyhow::Result<()> {
    let (stdin, payload) = build_stdin(path)?;
    let client = ProverClient::from_env();
    let (public_values, report) = client.execute(ELF, &stdin).run()?;

    eprintln!(
        "Executed aggregator program in {} cycles",
        report.total_instruction_count()
    );

    // SP1 recommended workflow: execute mode for dev iteration.
    // Returns mock proof so backend flow works without waiting for real proof.
    let response = ProverResponse {
        proof: BASE64.encode(b"mock-proof-execute-mode"),
        public_values: BASE64.encode(public_values.to_vec()),
        vk_hash: "0x0000000000000000000000000000000000000000000000000000000000000000".to_string(),
        metadata: AggregatedMetadata {
            self_nullifier: payload.self_nullifier,
            generation_id: payload.target_generation_id,
            social_level: payload.min_verified_needed,
            claim_hash: payload.generation_claim_hash,
        },
    };

    println!("{}", serde_json::to_string_pretty(&response)?);
    Ok(())
}

fn prove(path: PathBuf, network: ProverNetwork, mode: ProofMode) -> anyhow::Result<()> {
    use sp1_sdk::network::NetworkMode;

    let (stdin, payload) = build_stdin(path)?;

    match network {
        ProverNetwork::Local => prove_with_client(ProverClient::from_env(), stdin, payload, mode),
        ProverNetwork::Reserved => {
            let client = ProverClient::builder()
                .network_for(NetworkMode::Reserved)
                .build();
            prove_with_client(client, stdin, payload, mode)
        }
        ProverNetwork::Mainnet => {
            let client = ProverClient::builder()
                .network_for(NetworkMode::Mainnet)
                .build();
            prove_with_client(client, stdin, payload, mode)
        }
    }
}

// Optimization: we spawn fresh ProverClient for each /sp1/prove request.
// ProverClient::from_env() loads proving params from disk which takes 5-10 sec.
// Better approach: run CLI as daemon, accept requests via stdin, keep one ProverClient
// in Arc and reuse it. Would save the initialization overhead on every proof.
fn prove_with_client<P: Prover<CpuProverComponents>>(
    client: P,
    stdin: SP1Stdin,
    payload: AggregationInput,
    mode: ProofMode,
) -> anyhow::Result<()> {
    use sp1_sdk::SP1ProofMode;

    let (pk, vk) = client.setup(ELF);

    let sp1_mode = match mode {
        ProofMode::Core => SP1ProofMode::Core,
        ProofMode::Compressed => SP1ProofMode::Compressed,
        ProofMode::Groth16 => SP1ProofMode::Groth16,
        ProofMode::Plonk => SP1ProofMode::Plonk,
    };

    // Runs zkVM and generates proof. Local timing: compressed 10-20min, groth16 30min-2hr.
    // For production use SP1_NETWORK=mainnet to prove on Succinct network in under 5 min.
    let proof = client.prove(&pk, &stdin, sp1_mode)?;

    // Only groth16 and plonk support bytes32 for on-chain verification.
    let vk_hash = match mode {
        ProofMode::Groth16 | ProofMode::Plonk => format!("0x{}", hex::encode(vk.bytes32())),
        _ => format!("0x{}", hex::encode(vk.hash_bytes())),
    };

    let response = ProverResponse {
        proof: BASE64.encode(proof.bytes()),
        public_values: BASE64.encode(proof.public_values.to_vec()),
        vk_hash,
        metadata: AggregatedMetadata {
            self_nullifier: payload.self_nullifier,
            generation_id: payload.target_generation_id,
            social_level: payload.min_verified_needed,
            claim_hash: payload.generation_claim_hash,
        },
    };

    println!("{}", serde_json::to_string_pretty(&response)?);
    Ok(())
}

