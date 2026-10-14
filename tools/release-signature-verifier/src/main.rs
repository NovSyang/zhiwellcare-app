use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use std::{collections::HashMap, fs, io::Read};

// 参数仅含安装包、公钥和签名路径，不接收或输出任何私钥。
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 6 {
        return Err("需要 --artifact、--signature、--public-key 三组参数".into());
    }
    let mut options = HashMap::new();
    for pair in args.chunks_exact(2) {
        if !["--artifact", "--signature", "--public-key"].contains(&pair[0].as_str())
            || pair[1].starts_with("--")
            || options.insert(pair[0].as_str(), pair[1].as_str()).is_some()
        {
            return Err("参数未知、重复或缺少值".into());
        }
    }
    // 外层 Base64 解码与 Tauri updater 2.11 完全一致。
    let public_text = String::from_utf8(STANDARD.decode(options["--public-key"].trim())?)?;
    let signature_encoded = fs::read_to_string(options["--signature"])?;
    let signature_text = String::from_utf8(STANDARD.decode(signature_encoded.trim())?)?;
    let public_key = PublicKey::decode(&public_text)?;
    let signature = Signature::decode(&signature_text)?;
    let mut file = fs::File::open(options["--artifact"])?;
    let mut verifier = public_key.verify_stream(&signature)?;
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 { break; }
        verifier.update(&buffer[..count]);
    }
    verifier.finalize()?;
    println!("Tauri updater 签名验证通过");
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        // 公共诊断只说明验签失败，不打印完整参数或签名材料。
        eprintln!("安装包签名验证失败：{error}");
        std::process::exit(1);
    }
}
