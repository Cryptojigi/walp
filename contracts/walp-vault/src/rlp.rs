#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RlpDecodeError {
    EmptyInput,
    UnsupportedTxType(u8),
    MalformedHex(&'static str),
    UnexpectedEof,
    NonCanonicalEncoding,
    NonCanonicalInteger,
    TrailingBytes,
    ExpectedList,
    ExpectedBytes,
    InvalidFieldCount(usize),
    InvalidToAddressLen(usize),
    IntegerOverflow(&'static str),
    ValueExceedsU128,
    InvalidAccessList,
}

impl core::fmt::Display for RlpDecodeError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::EmptyInput => write!(f, "empty transaction payload"),
            Self::UnsupportedTxType(t) => write!(f, "expected EIP-1559 type 0x02 tx, got 0x{:02x}", t),
            Self::MalformedHex(msg) => write!(f, "malformed hex: {}", msg),
            Self::UnexpectedEof => write!(f, "unexpected end of RLP payload"),
            Self::NonCanonicalEncoding => write!(f, "non-canonical RLP length encoding"),
            Self::NonCanonicalInteger => write!(f, "non-canonical integer with leading zero byte"),
            Self::TrailingBytes => write!(f, "trailing bytes after EIP-1559 RLP list"),
            Self::ExpectedList => write!(f, "expected RLP list"),
            Self::ExpectedBytes => write!(f, "expected RLP byte string"),
            Self::InvalidFieldCount(n) => write!(f, "expected 9 EIP-1559 fields, got {}", n),
            Self::InvalidToAddressLen(n) => write!(f, "invalid recipient length {} (contract creation or non-20B `to` rejected)", n),
            Self::IntegerOverflow(field) => write!(f, "integer overflow in {}", field),
            Self::ValueExceedsU128 => write!(f, "decoded value exceeds u128::MAX"),
            Self::InvalidAccessList => write!(f, "invalid EIP-1559 accessList structure"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RlpItem<'a> {
    Bytes(&'a [u8]),
    List(Vec<RlpItem<'a>>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedEip1559Tx {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub gas_limit: u64,
    pub to: String,
    pub value_wei: u128,
    pub data: Vec<u8>,
    pub calldata_selector: String,
}

const MAX_RAW_TX_BYTES: usize = 65_536;

pub fn decode_hex(raw: &str) -> Result<Vec<u8>, RlpDecodeError> {
    let trimmed = raw.trim();
    let hex_str = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);

    if hex_str.is_empty() {
        return Err(RlpDecodeError::EmptyInput);
    }
    if !hex_str.len().is_multiple_of(2) {
        return Err(RlpDecodeError::MalformedHex("odd number of hex chars"));
    }
    if hex_str.len() / 2 > MAX_RAW_TX_BYTES {
        return Err(RlpDecodeError::MalformedHex("payload exceeds 64 KiB limit"));
    }

    let mut out = Vec::with_capacity(hex_str.len() / 2);
    let bytes = hex_str.as_bytes();
    for i in (0..bytes.len()).step_by(2) {
        let hi = hex_nibble(bytes[i])?;
        let lo = hex_nibble(bytes[i + 1])?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn hex_nibble(b: u8) -> Result<u8, RlpDecodeError> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err(RlpDecodeError::MalformedHex("non-hex character")),
    }
}

pub fn encode_hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

pub fn normalize_evm_address(raw: &str) -> Result<String, &'static str> {
    let trimmed = raw.trim();
    let hex_part = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .ok_or("WALP_INVALID_ADDRESS: missing 0x prefix")?;
    if hex_part.len() != 40 || !hex_part.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("WALP_INVALID_ADDRESS: expected 20-byte EVM hex address");
    }
    Ok(format!("0x{}", hex_part.to_ascii_lowercase()))
}

fn parse_be_len(slice: &[u8]) -> Result<usize, RlpDecodeError> {
    if slice.is_empty() || slice[0] == 0 {
        return Err(RlpDecodeError::NonCanonicalEncoding);
    }
    if slice.len() > core::mem::size_of::<usize>() {
        return Err(RlpDecodeError::UnexpectedEof);
    }
    let mut val: usize = 0;
    for &b in slice {
        val = (val << 8) | (b as usize);
    }
    if val <= 55 {
        return Err(RlpDecodeError::NonCanonicalEncoding);
    }
    Ok(val)
}

fn decode_rlp_item<'a>(input: &'a [u8], depth: u8) -> Result<(RlpItem<'a>, usize), RlpDecodeError> {
    if depth > 8 {
        return Err(RlpDecodeError::InvalidAccessList);
    }
    let &first = input.first().ok_or(RlpDecodeError::UnexpectedEof)?;

    if first < 0x80 {
        Ok((RlpItem::Bytes(&input[..1]), 1))
    } else if first <= 0xb7 {
        let len = (first - 0x80) as usize;
        let end = 1usize.checked_add(len).ok_or(RlpDecodeError::UnexpectedEof)?;
        if input.len() < end {
            return Err(RlpDecodeError::UnexpectedEof);
        }
        if len == 1 && input[1] < 0x80 {
            return Err(RlpDecodeError::NonCanonicalEncoding);
        }
        Ok((RlpItem::Bytes(&input[1..end]), end))
    } else if first <= 0xbf {
        let len_of_len = (first - 0xb7) as usize;
        let header_end = 1usize
            .checked_add(len_of_len)
            .ok_or(RlpDecodeError::UnexpectedEof)?;
        if input.len() < header_end {
            return Err(RlpDecodeError::UnexpectedEof);
        }
        let len = parse_be_len(&input[1..header_end])?;
        let end = header_end
            .checked_add(len)
            .ok_or(RlpDecodeError::UnexpectedEof)?;
        if input.len() < end {
            return Err(RlpDecodeError::UnexpectedEof);
        }
        Ok((RlpItem::Bytes(&input[header_end..end]), end))
    } else if first <= 0xf7 {
        let len = (first - 0xc0) as usize;
        let end = 1usize.checked_add(len).ok_or(RlpDecodeError::UnexpectedEof)?;
        if input.len() < end {
            return Err(RlpDecodeError::UnexpectedEof);
        }
        let items = decode_rlp_list_payload(&input[1..end], depth + 1)?;
        Ok((RlpItem::List(items), end))
    } else {
        let len_of_len = (first - 0xf7) as usize;
        let header_end = 1usize
            .checked_add(len_of_len)
            .ok_or(RlpDecodeError::UnexpectedEof)?;
        if input.len() < header_end {
            return Err(RlpDecodeError::UnexpectedEof);
        }
        let len = parse_be_len(&input[1..header_end])?;
        let end = header_end
            .checked_add(len)
            .ok_or(RlpDecodeError::UnexpectedEof)?;
        if input.len() < end {
            return Err(RlpDecodeError::UnexpectedEof);
        }
        let items = decode_rlp_list_payload(&input[header_end..end], depth + 1)?;
        Ok((RlpItem::List(items), end))
    }
}

fn decode_rlp_list_payload<'a>(
    payload: &'a [u8],
    depth: u8,
) -> Result<Vec<RlpItem<'a>>, RlpDecodeError> {
    let mut items = Vec::new();
    let mut offset = 0;
    while offset < payload.len() {
        let (item, consumed) = decode_rlp_item(&payload[offset..], depth)?;
        items.push(item);
        offset += consumed;
    }
    Ok(items)
}

fn item_bytes<'a>(item: &'a RlpItem<'a>) -> Result<&'a [u8], RlpDecodeError> {
    match item {
        RlpItem::Bytes(b) => Ok(b),
        RlpItem::List(_) => Err(RlpDecodeError::ExpectedBytes),
    }
}

fn decode_u64(item: &RlpItem<'_>, field: &'static str) -> Result<u64, RlpDecodeError> {
    let bytes = item_bytes(item)?;
    if bytes.is_empty() {
        return Ok(0);
    }
    if bytes[0] == 0 {
        return Err(RlpDecodeError::NonCanonicalInteger);
    }
    if bytes.len() > 8 {
        return Err(RlpDecodeError::IntegerOverflow(field));
    }
    let mut val = 0u64;
    for &b in bytes {
        val = (val << 8) | (b as u64);
    }
    Ok(val)
}

fn decode_u128(item: &RlpItem<'_>, field: &'static str, is_value: bool) -> Result<u128, RlpDecodeError> {
    let bytes = item_bytes(item)?;
    if bytes.is_empty() {
        return Ok(0);
    }
    if bytes[0] == 0 {
        return Err(RlpDecodeError::NonCanonicalInteger);
    }
    if bytes.len() > 16 {
        return Err(if is_value {
            RlpDecodeError::ValueExceedsU128
        } else {
            RlpDecodeError::IntegerOverflow(field)
        });
    }
    let mut val = 0u128;
    for &b in bytes {
        val = (val << 8) | (b as u128);
    }
    Ok(val)
}

fn validate_access_list(item: &RlpItem<'_>) -> Result<(), RlpDecodeError> {
    let RlpItem::List(entries) = item else {
        return Err(RlpDecodeError::InvalidAccessList);
    };
    for entry in entries {
        let RlpItem::List(pair) = entry else {
            return Err(RlpDecodeError::InvalidAccessList);
        };
        if pair.len() != 2 {
            return Err(RlpDecodeError::InvalidAccessList);
        }
        let addr = item_bytes(&pair[0]).map_err(|_| RlpDecodeError::InvalidAccessList)?;
        if addr.len() != 20 {
            return Err(RlpDecodeError::InvalidAccessList);
        }
        let RlpItem::List(keys) = &pair[1] else {
            return Err(RlpDecodeError::InvalidAccessList);
        };
        for key in keys {
            let k = item_bytes(key).map_err(|_| RlpDecodeError::InvalidAccessList)?;
            if k.len() != 32 {
                return Err(RlpDecodeError::InvalidAccessList);
            }
        }
    }
    Ok(())
}

pub fn decode_eip1559_unsigned(raw_tx: &[u8]) -> Result<DecodedEip1559Tx, RlpDecodeError> {
    if raw_tx.is_empty() {
        return Err(RlpDecodeError::EmptyInput);
    }
    if raw_tx[0] != 0x02 {
        return Err(RlpDecodeError::UnsupportedTxType(raw_tx[0]));
    }
    let body = &raw_tx[1..];
    let (top, consumed) = decode_rlp_item(body, 0)?;
    if consumed != body.len() {
        return Err(RlpDecodeError::TrailingBytes);
    }
    let RlpItem::List(fields) = top else {
        return Err(RlpDecodeError::ExpectedList);
    };
    if fields.len() != 9 {
        return Err(RlpDecodeError::InvalidFieldCount(fields.len()));
    }

    let chain_id = decode_u64(&fields[0], "chain_id")?;
    let nonce = decode_u64(&fields[1], "nonce")?;
    let max_priority_fee_per_gas = decode_u128(&fields[2], "max_priority_fee_per_gas", false)?;
    let max_fee_per_gas = decode_u128(&fields[3], "max_fee_per_gas", false)?;
    let gas_limit = decode_u64(&fields[4], "gas_limit")?;

    let to_bytes = item_bytes(&fields[5])?;
    if to_bytes.len() != 20 {
        return Err(RlpDecodeError::InvalidToAddressLen(to_bytes.len()));
    }
    let to = format!("0x{}", encode_hex_lower(to_bytes));

    let value_wei = decode_u128(&fields[6], "value", true)?;
    let data = item_bytes(&fields[7])?.to_vec();
    validate_access_list(&fields[8])?;

    let calldata_selector = if data.is_empty() {
        "0x".to_string()
    } else {
        let prefix_len = data.len().min(4);
        format!("0x{}", encode_hex_lower(&data[..prefix_len]))
    };

    Ok(DecodedEip1559Tx {
        chain_id,
        nonce,
        max_priority_fee_per_gas,
        max_fee_per_gas,
        gas_limit,
        to,
        value_wei,
        data,
        calldata_selector,
    })
}

pub fn inspect_calldata(data: &[u8], blocked_selectors: &[String]) -> Result<(), String> {
    if data.is_empty() {
        return Ok(());
    }
    if data.len() < 4 {
        return Err(format!(
            "Truncated calldata ({} bytes) shorter than 4-byte EVM selector",
            data.len()
        ));
    }

    let selector = format!("0x{}", encode_hex_lower(&data[..4]));
    if blocked_selectors
        .iter()
        .any(|s| s.eq_ignore_ascii_case(&selector))
    {
        return Err(format!("Blocked EVM selector {}", selector));
    }

    // ERC-20 approve(address,uint256) or increaseAllowance(address,uint256)
    if selector == "0x095ea7b3" || selector == "0x39509351" {
        if data.len() != 68 {
            return Err(format!(
                "Malformed ERC-20 allowance calldata length {} (expected 68 bytes)",
                data.len()
            ));
        }
        // Reject unlimited or >= 2^128 allowances (covers uint256::MAX 0xff..ff and high-bit drains)
        if data[36..52].iter().any(|&b| b != 0) {
            return Err(format!(
                "Unlimited or >= 2^128 ERC-20 allowance blocked for selector {}",
                selector
            ));
        }
    }

    // ERC-721 / ERC-1155 setApprovalForAll(address,bool)
    if selector == "0xa22cb465" {
        if data.len() != 68 {
            return Err(format!(
                "Malformed setApprovalForAll calldata length {}",
                data.len()
            ));
        }
        if data[36..68].iter().any(|&b| b != 0) {
            return Err("NFT setApprovalForAll(operator, true) blocked".to_string());
        }
    }

    Ok(())
}
