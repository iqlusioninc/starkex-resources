/////////////////////////////////////////////////////////////////////////////////
// Copyright 2019 StarkWare Industries Ltd.                                    //
//                                                                             //
// Licensed under the Apache License, Version 2.0 (the "License").             //
// You may not use this file except in compliance with the License.            //
// You may obtain a copy of the License at                                     //
//                                                                             //
// https://www.starkware.co/open-source-license/                               //
//                                                                             //
// Unless required by applicable law or agreed to in writing,                  //
// software distributed under the License is distributed on an "AS IS" BASIS,  //
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.    //
// See the License for the specific language governing permissions             //
// and limitations under the License.                                          //
/////////////////////////////////////////////////////////////////////////////////

const BN = require('bn.js');
const hash = require('hash.js');
const { curves: eCurves, ec: EllipticCurve } = require('elliptic');
const assert = require('assert');
const constantPointsHex = require('./constant_points.json');

const prime = new BN('800000000000011000000000000000000000000000000000000000000000001', 16);
exports.prime = prime;

const starkEc = new EllipticCurve(
    new eCurves.PresetCurve({
        type: 'short',
        prime: null,
        p: prime,
        a: '00000000 00000000 00000000 00000000 00000000 00000000 00000000 00000001',
        b: '06f21413 efbe40de 150e596d 72f7a8c5 609ad26c 15c915c1 f4cdfcb9 9cee9e89',
        n: '08000000 00000010 ffffffff ffffffff b781126d cae7b232 1e66a241 adc64d2f',
        hash: hash.sha256,
        gRed: false,
        g: constantPointsHex[1]
    })
);
exports.ec = starkEc;

const constantPoints = constantPointsHex.map(coords => (
    starkEc.curve.point(new BN(coords[0], 16), new BN(coords[1], 16))));
exports.constantPoints = constantPoints;
const shiftPoint = constantPoints[0];
exports.shiftPoint = shiftPoint;

function pedersen(input) {
    const zero = new BN('0');
    const one = new BN('1');
    let point = shiftPoint;
    for (let i = 0; i < input.length; i++) {
        let x = new BN(input[i], 16);
        assert(x.gte(zero) && x.lt(prime), 'Invalid input: ' + input[i]);
        for (let j = 0; j < 252; j++) {
            const pt = constantPoints[2 + i * 252 + j];
            assert(!point.getX().eq(pt.getX()));
            if (x.and(one).toNumber() !== 0) {
                point = point.add(pt);
            }
            x = x.shrn(1);
        }
    }
    return point.getX().toString(16);
}
exports.pedersen = pedersen;

function signMsg(
    instructionTypeBn,
    vault0Bn,
    vault1Bn,
    amount0Bn,
    amount1Bn,
    nonceBn,
    expirationTimestampBn,
    token0,
    token1OrPubKey
) {
    let packedMessage = instructionTypeBn;
    packedMessage = packedMessage.ushln(31).add(vault0Bn);
    packedMessage = packedMessage.ushln(31).add(vault1Bn);
    packedMessage = packedMessage.ushln(63).add(amount0Bn);
    packedMessage = packedMessage.ushln(63).add(amount1Bn);
    packedMessage = packedMessage.ushln(31).add(nonceBn);
    packedMessage = packedMessage.ushln(22).add(expirationTimestampBn);
    return pedersen([
        pedersen([token0, token1OrPubKey]), packedMessage.toString(16)
    ]);
}

/*
 Serializes the order message in the canonical format expected by the verifier.
 party_a sells amountSell coins of tokenSell from vaultSell.
 party_a buys amountBuy coins of tokenBuy into vaultBuy.

 Expected types:
 ---------------
 vaultSell, vaultBuy - uint31 (as int)
 amountSell, amountBuy - uint63 (as decimal string)
 tokenSell, tokenBuy - uint256 field element strictly less than the prime (as hex string with 0x)
 nonce - uint31 (as int)
 expirationTimestamp - uint22 (as int).
*/
exports.getLimitOrderMsg = function(
    vaultSell,
    vaultBuy,
    amountSell,
    amountBuy,
    tokenSell,
    tokenBuy,
    nonce,
    expirationTimestamp
) {
    assert(
        tokenSell.substring(0, 2) === '0x' && tokenBuy.substring(0, 2) === '0x',
        'Hex strings expected to be prefixed with 0x.'
    );
    const vaultSellBn = new BN(vaultSell);
    const vaultBuyBn = new BN(vaultBuy);
    const amountSellBn = new BN(amountSell, 10);
    const amountBuyBn = new BN(amountBuy, 10);
    const tokenSellBn = new BN(tokenSell.substring(2), 16);
    const tokenBuyBn = new BN(tokenBuy.substring(2), 16);
    const nonceBn = new BN(nonce);
    const expirationTimestampBn = new BN(expirationTimestamp);

    const zero = new BN('0');
    const twoPow22 = new BN('400000', 16);
    const twoPow31 = new BN('80000000', 16);
    const twoPow63 = new BN('8000000000000000', 16);
    assert(vaultSellBn.gte(zero));
    assert(vaultBuyBn.gte(zero));
    assert(amountSellBn.gte(zero));
    assert(amountBuyBn.gte(zero));
    assert(tokenSellBn.gte(zero));
    assert(tokenBuyBn.gte(zero));
    assert(nonceBn.gte(zero));
    assert(expirationTimestampBn.gte(zero));
    assert(vaultSellBn.lt(twoPow31));
    assert(vaultBuyBn.lt(twoPow31));
    assert(amountSellBn.lt(twoPow63));
    assert(amountBuyBn.lt(twoPow63));
    assert(tokenSellBn.lt(prime));
    assert(tokenBuyBn.lt(prime));
    assert(nonceBn.lt(twoPow31));
    assert(expirationTimestampBn.lt(twoPow22));

    const instructionType = zero;
    return signMsg(instructionType,
        vaultSellBn,
        vaultBuyBn,
        amountSellBn,
        amountBuyBn,
        nonceBn,
        expirationTimestampBn,
        tokenSell.substring(2),
        tokenBuy.substring(2));
};

/*
 Serializes the transfer message in the canonical format expected by the verifier.
 The sender transfer 'amount' coins of 'token' from vault with id senderVaultId to vault with id
 receiverVaultId. The receiver's public key is receiverPublicKey.
 Expected types:
 ---------------
 amount - uint63 (as decimal string)
 nonce - uint31 (as int)
 senderVaultId uint31 (as int)
 token - uint256 field element strictly less than the prime (as hex string with 0x)
 receiverVaultId - uint31 (as int)
 receiverPublicKey - uint256 field element strictly less than the prime (as hex string with 0x)
 expirationTimestamp - uint22 (as int).
*/
exports.getTransferMsg = function(
    amount,
    nonce,
    senderVaultId,
    token,
    receiverVaultId,
    receiverPublicKey,
    expirationTimestamp
) {
    assert(
        token.substring(0, 2) === '0x' && receiverPublicKey.substring(0, 2) === '0x',
        'Hex strings expected to be prefixed with 0x.'
    );
    const amountBn = new BN(amount, 10);
    const nonceBn = new BN(nonce);
    const senderVaultIdBn = new BN(senderVaultId);
    const tokenBn = new BN(token.substring(2), 16);
    const receiverVaultIdBn = new BN(receiverVaultId);
    const receiverPublicKeyBn = new BN(receiverPublicKey.substring(2), 16);
    const expirationTimestampBn = new BN(expirationTimestamp);

    const zero = new BN('0');
    const one = new BN('1');
    const twoPow22 = new BN('400000', 16);
    const twoPow31 = new BN('80000000', 16);
    const twoPow63 = new BN('8000000000000000', 16);
    assert(amountBn.gte(zero));
    assert(nonceBn.gte(zero));
    assert(senderVaultIdBn.gte(zero));
    assert(tokenBn.gte(zero));
    assert(receiverVaultIdBn.gte(zero));
    assert(receiverPublicKeyBn.gte(zero));
    assert(expirationTimestampBn.gte(zero));
    assert(amountBn.lt(twoPow63));
    assert(nonceBn.lt(twoPow31));
    assert(senderVaultIdBn.lt(twoPow31));
    assert(tokenBn.lt(prime));
    assert(receiverVaultIdBn.lt(twoPow31));
    assert(receiverPublicKeyBn.lt(prime));
    assert(expirationTimestampBn.lt(twoPow22));

    const instructionType = one;
    return signMsg(
        instructionType,
        senderVaultIdBn,
        receiverVaultIdBn,
        amountBn,
        zero,
        nonceBn,
        expirationTimestampBn,
        token.substring(2),
        receiverPublicKey.substring(2)
    );
};

/*
 The function _truncateToN in lib/elliptic/ec/index.js does a shift-right of 4 bits
 in some cases. This function does the opposite operation so that
   _truncateToN(fixMessage(msg)) == msg.
*/
function fixMessage(msg) {
    // Convert to BN to remove leading zeros.
    msg = new BN(msg, 16).toString(16);

    if (msg.length <= 62) {
        // In this case, msg should not be transformed, as the byteLength() is at most 31,
        // so delta < 0 (see _truncateToN).
        return msg;
    }
    assert(msg.length === 63);
    // In this case delta will be 4 so we perform a shift-left of 4 bits by adding a zero.
    return msg + '0';
}

/*
 Signs a message using the provided key.
 key should be an elliptic.keyPair with a valid private key.
 Returns an elliptic.Signature.
*/
exports.sign = (keyPair, msg) => keyPair.sign(fixMessage(msg));

/*
 Verifies a message using the provided key.
 key should be an elliptic.keyPair with a valid public key.
 msgSignature should be an elliptic.Signature.
 Returns a boolean true if the verification succeeds.
*/
exports.verify = (keyPair, msg, msgSignature) => keyPair.verify(fixMessage(msg), msgSignature);
