use std::{fs, path::PathBuf};

use anyhow::Context;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use clap::{Parser, Subcommand, ValueEnum};
use serde::{Deserialize, Serialize};
use sp1_sdk::{include_elf, network::NetworkMode, utils, HashableKey, ProverClient, SP1Stdin};

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
    Testnet,
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

#[derive(Deserialize)]
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

fn build_stdin(path: PathBuf) -> anyhow::Result<(SP1Stdin, AggregationInput)> {
    let raw = fs::read(&path)
        .with_context(|| format!("Failed to read input file {}", path.display()))?;
    let payload: AggregationInput = serde_json::from_slice(&raw)
        .with_context(|| format!("Invalid aggregator payload {}", path.display()))?;

    let mut stdin = SP1Stdin::new();
    stdin.write(&payload);
    Ok((stdin, payload))
}

fn execute_only(path: PathBuf) -> anyhow::Result<()> {
    let (stdin, _) = build_stdin(path)?;
    let client = ProverClient::from_env();
    let (_, report) = client.execute(ELF, &stdin).run()?;
    println!(
        "Executed aggregator program in {} cycles",
        report.total_instruction_count()
    );
    Ok(())
}

fn prove(path: PathBuf, network: ProverNetwork, mode: ProofMode) -> anyhow::Result<()> {
    let (stdin, payload) = build_stdin(path)?;
    let client = build_client(network);
    let (pk, vk) = client.setup(ELF);
    let request = client.prove(&pk, &stdin);
    let prover = match mode {
        ProofMode::Core => request.run()?,
        ProofMode::Compressed => request.compressed().run()?,
        ProofMode::Groth16 => request.groth16().run()?,
        ProofMode::Plonk => request.plonk().run()?,
    };

    let response = ProverResponse {
        proof: BASE64.encode(prover.bytes()),
        public_values: BASE64.encode(prover.public_values.to_vec()),
        vk_hash: format!("0x{}", hex::encode(vk.bytes32())),
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

fn build_client(network: ProverNetwork) -> ProverClient {
    match network {
        ProverNetwork::Local => ProverClient::from_env(),
        ProverNetwork::Testnet => ProverClient::builder()
            .network_for(NetworkMode::Testnet)
            .build(),
        ProverNetwork::Mainnet => ProverClient::builder()
            .network_for(NetworkMode::Mainnet)
            .build(),
    }
}
