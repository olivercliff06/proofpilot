/**
 * Deterministic verification logic for ProofPilot.
 *
 * All verification functions return a structured result with status (PASS/FAIL/UNVERIFIED)
 * and details. Network errors and rate limits produce UNVERIFIED. Status assignment
 * happens entirely in TypeScript before any LLM involvement.
 */

export interface VerificationResult {
  status: "PASS" | "FAIL" | "UNVERIFIED";
  details: string;
}

export interface VerificationInputs {
  bountyRequirements: string;
  githubUrl: string;
  contractAddress: string;
  txHash: string;
}

export interface VerificationResults {
  inputValidation: VerificationResult;
  githubReachable: VerificationResult;
  readmeExists: VerificationResult;
  bytecodeExists: VerificationResult;
  txSuccess: VerificationResult;
  contractMatch: VerificationResult;
}

const BSC_TESTNET_RPC = "https://bsc-testnet-rpc.publicnode.com";

/**
 * Normalize GitHub URL by removing trailing slash and .git suffix.
 */
function normalizeGitHubUrl(url: string): string {
  return url.replace(/\/$/, "").replace(/\.git$/, "");
}

/**
 * Parse owner and repo from GitHub URL.
 * Returns null if URL format is invalid.
 */
function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const normalized = normalizeGitHubUrl(url);
  const match = normalized.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Validate input fields format.
 */
export function validateInputFields(
  bountyRequirements: string,
  githubUrl: string,
  contractAddress: string,
  txHash: string,
): VerificationResult {
  const errors: string[] = [];

  if (!bountyRequirements || bountyRequirements.trim() === "") {
    errors.push("Bounty requirements is empty");
  }

  if (!githubUrl || githubUrl.trim() === "") {
    errors.push("GitHub URL is empty");
  } else if (!parseGitHubRepo(githubUrl)) {
    errors.push("GitHub URL format is invalid (expected: https://github.com/owner/repo)");
  }

  if (!contractAddress || contractAddress.trim() === "") {
    errors.push("Contract address is empty");
  } else if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    errors.push("Contract address format is invalid (expected 0x followed by 40 hex characters)");
  }

  if (!txHash || txHash.trim() === "") {
    errors.push("Transaction hash is empty");
  } else if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    errors.push("Transaction hash format is invalid (expected 0x followed by 64 hex characters)");
  }

  if (errors.length > 0) {
    return { status: "FAIL", details: errors.join("; ") };
  }

  return { status: "PASS", details: "All input fields are valid" };
}

/**
 * Check if GitHub repository is reachable via GitHub API.
 */
export async function checkGitHubRepoReachable(
  githubUrl: string,
): Promise<VerificationResult> {
  const parsed = parseGitHubRepo(githubUrl);
  if (!parsed) {
    return { status: "FAIL", details: "Invalid GitHub URL format" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);

    if (response.status === 404) {
      return { status: "FAIL", details: "Repository not found on GitHub" };
    }
    if (response.status === 403) {
      return {
        status: "UNVERIFIED",
        details: "GitHub API rate limit exceeded",
      };
    }
    if (!response.ok) {
      return {
        status: "UNVERIFIED",
        details: `GitHub API returned status ${response.status}`,
      };
    }
    return { status: "PASS", details: "Repository is reachable" };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { status: "UNVERIFIED", details: "Request timeout" };
    }
    return {
      status: "UNVERIFIED",
      details: "Network error",
    };
  }
}

/**
 * Check if README exists in the repository via GitHub API.
 */
export async function checkGitHubReadmeExists(
  githubUrl: string,
): Promise<VerificationResult> {
  const parsed = parseGitHubRepo(githubUrl);
  if (!parsed) {
    return { status: "FAIL", details: "Invalid GitHub URL format" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/readme`,
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);

    if (response.status === 404) {
      return { status: "FAIL", details: "README not found in repository" };
    }
    if (response.status === 403) {
      return {
        status: "UNVERIFIED",
        details: "GitHub API rate limit exceeded",
      };
    }
    if (!response.ok) {
      return {
        status: "UNVERIFIED",
        details: `GitHub API returned status ${response.status}`,
      };
    }
    return { status: "PASS", details: "README exists in repository" };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { status: "UNVERIFIED", details: "Request timeout" };
    }
    return {
      status: "UNVERIFIED",
      details: "Network error",
    };
  }
}

/**
 * Check if bytecode exists at the contract address on BSC testnet.
 */
export async function checkContractBytecodeExists(
  contractAddress: string,
  network: string,
): Promise<VerificationResult> {
  const rpcUrl = network === "bsc-testnet" ? BSC_TESTNET_RPC : network;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getCode",
        params: [contractAddress, "latest"],
        id: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await response.json();
    if (data.error) {
      return {
        status: "UNVERIFIED",
        details: `RPC error: ${data.error.message || String(data.error)}`,
      };
    }

    const bytecode = data.result;
    if (!bytecode || bytecode === "0x" || bytecode === "0x0") {
      return { status: "FAIL", details: "No bytecode at contract address" };
    }

    return { status: "PASS", details: "Bytecode exists at contract address" };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { status: "UNVERIFIED", details: "Request timeout" };
    }
    return {
      status: "UNVERIFIED",
      details: "Network error",
    };
  }
}

/**
 * Fetch transaction receipt from BSC testnet RPC once.
 * Returns the receipt or null if not found/error.
 */
async function fetchTransactionReceiptOnce(
  txHash: string,
  network: string,
): Promise<Record<string, unknown> | null> {
  const rpcUrl = network === "bsc-testnet" ? BSC_TESTNET_RPC : network;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getTransactionReceipt",
        params: [txHash],
        id: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await response.json();
    if (data.error) {
      return null;
    }

    return data.result as Record<string, unknown>;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return null;
    }
    return null;
  }
}

/**
 * Derive transaction success status from receipt.
 */
function deriveTxSuccess(
  receipt: Record<string, unknown> | null,
): VerificationResult {
  if (!receipt) {
    return { status: "UNVERIFIED", details: "Transaction receipt not found" };
  }

  const status = receipt.status;
  // status is "0x1" for success, "0x0" for failure
  if (status === "0x1") {
    return { status: "PASS", details: "Transaction succeeded" };
  }
  if (status === "0x0") {
    return { status: "FAIL", details: "Transaction failed" };
  }

  return { status: "UNVERIFIED", details: "Unable to determine transaction status" };
}

/**
 * Derive contract address match from receipt.
 */
function deriveContractMatch(
  receipt: Record<string, unknown> | null,
  submittedAddress: string,
): VerificationResult {
  if (!receipt) {
    return { status: "UNVERIFIED", details: "Transaction receipt not found" };
  }

  const receiptContractAddress = receipt.contractAddress;

  if (receiptContractAddress === null || receiptContractAddress === undefined) {
    return {
      status: "FAIL",
      details: "Transaction receipt has no contractAddress field - this MVP supports direct contract deployments only (not factory deployments)",
    };
  }

  const normalizedReceipt = String(receiptContractAddress).toLowerCase();
  const normalizedSubmitted = submittedAddress.toLowerCase();

  if (normalizedReceipt === normalizedSubmitted) {
    return { status: "PASS", details: "Receipt contract address matches submitted address" };
  }

  return {
    status: "FAIL",
    details: `Receipt contract address (${receiptContractAddress}) does not match submitted address (${submittedAddress})`,
  };
}

/**
 * Generate Markdown evidence report from verification results.
 */
export function generateEvidenceReport(
  inputs: VerificationInputs,
  results: VerificationResults,
): string {
  const lines: string[] = [];

  lines.push("# ProofPilot Verification Report");
  lines.push("");
  lines.push("## Inputs");
  lines.push("");
  lines.push(`- **Bounty Requirements:** ${inputs.bountyRequirements}`);
  lines.push(`- **GitHub Repository:** ${inputs.githubUrl}`);
  lines.push(`- **Contract Address:** ${inputs.contractAddress}`);
  lines.push(`- **Deployment Transaction:** ${inputs.txHash}`);
  lines.push("");
  lines.push(
    "> **Note:** Arbitrary bounty requirements are recorded as context but are not evaluated by this MVP.",
  );
  lines.push("");
  lines.push("## Verification Results");
  lines.push("");
  lines.push("| Criterion | Status | Details |");
  lines.push("|-----------|--------|---------|");
  lines.push(
    `| Input field validation | ${results.inputValidation.status} | ${results.inputValidation.details} |`,
  );
  lines.push(
    `| GitHub repository reachable | ${results.githubReachable.status} | ${results.githubReachable.details} |`,
  );
  lines.push(
    `| README exists | ${results.readmeExists.status} | ${results.readmeExists.details} |`,
  );
  lines.push(
    `| Contract bytecode exists | ${results.bytecodeExists.status} | ${results.bytecodeExists.details} |`,
  );
  lines.push(
    `| Deployment transaction succeeded | ${results.txSuccess.status} | ${results.txSuccess.details} |`,
  );
  lines.push(
    `| Receipt contract address matches | ${results.contractMatch.status} | ${results.contractMatch.details} |`,
  );
  lines.push("");

  return lines.join("\n");
}

/**
 * Run all verifications.
 * Skips network calls for fields that fail input validation.
 * Fetches transaction receipt once and derives both txSuccess and contractMatch from it.
 */
export async function runVerifications(
  inputs: VerificationInputs,
  network: string,
): Promise<VerificationResults> {
  const inputValidation = validateInputFields(
    inputs.bountyRequirements,
    inputs.githubUrl,
    inputs.contractAddress,
    inputs.txHash,
  );

  // Skip network calls if input validation fails for specific fields
  const githubValid = inputValidation.status === "PASS" || !inputValidation.details.includes("GitHub URL");
  const contractValid = inputValidation.status === "PASS" || !inputValidation.details.includes("Contract address");
  const txValid = inputValidation.status === "PASS" || !inputValidation.details.includes("Transaction hash");

  // Fetch transaction receipt once (if tx hash is valid)
  let receipt: Record<string, unknown> | null = null;
  if (txValid) {
    receipt = await fetchTransactionReceiptOnce(inputs.txHash, network);
  }

  const [githubReachable, readmeExists, bytecodeExists]: [VerificationResult, VerificationResult, VerificationResult] = await Promise.all([
    githubValid ? checkGitHubRepoReachable(inputs.githubUrl) : Promise.resolve<VerificationResult>({ status: "UNVERIFIED", details: "Skipped due to invalid GitHub URL" }),
    githubValid ? checkGitHubReadmeExists(inputs.githubUrl) : Promise.resolve<VerificationResult>({ status: "UNVERIFIED", details: "Skipped due to invalid GitHub URL" }),
    contractValid ? checkContractBytecodeExists(inputs.contractAddress, network) : Promise.resolve<VerificationResult>({ status: "UNVERIFIED", details: "Skipped due to invalid contract address" }),
  ]);

  // Derive txSuccess and contractMatch from the single receipt fetch
  const txSuccess: VerificationResult = txValid ? deriveTxSuccess(receipt) : { status: "UNVERIFIED", details: "Skipped due to invalid transaction hash" };
  const contractMatch: VerificationResult = (txValid && contractValid) ? deriveContractMatch(receipt, inputs.contractAddress) : { status: "UNVERIFIED", details: "Skipped due to invalid input" };

  return {
    inputValidation,
    githubReachable,
    readmeExists,
    bytecodeExists,
    txSuccess,
    contractMatch,
  };
}
