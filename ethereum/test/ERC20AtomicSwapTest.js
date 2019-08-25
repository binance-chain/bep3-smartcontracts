const BNBToken = artifacts.require("BNBToken");
const ERC20AtomicSwapper = artifacts.require("ERC20AtomicSwapper");
const crypto = require('crypto');
const truffleAssert = require('truffle-assertions');
const calculateRandomNumberHash = require('./secretHashLock')


contract('Verify BNBToken and ERC20AtomicSwapper', (accounts) => {
    it('Check init state for BNBToken and ERC20AtomicSwapper', async () => {
        const initSupply = 10000000000000000;

        const bnbInstance = await BNBToken.deployed();
        const balance = await bnbInstance.balanceOf.call(accounts[0]);
        assert.equal(Number(balance.toString()), initSupply, "10000000000000000 wasn't in the first account");

        const name = await bnbInstance.name.call();
        assert.equal(name, "BNB Token", "Contract name should be BNB Token");

        const symbol = await bnbInstance.symbol.call();
        assert.equal(symbol, "BNB", "Token symbol should be BNB");

        const decimals = await bnbInstance.decimals.call();
        assert.equal(decimals, 8, "Token decimals should be 8");

        const totalSupply = await bnbInstance.totalSupply.call();
        assert.equal(Number(totalSupply.toString()), initSupply, "Token total supply should be 10000000000000000");

        const owner = await bnbInstance.owner.call();
        assert.equal(owner, accounts[0], "Contract owner should be accounts[0]");

        const paused = await bnbInstance.paused.call();
        assert.equal(paused, false, "Contract paused status should be false");

        const swapInstance = await ERC20AtomicSwapper.deployed();
        const erc20Address = await swapInstance.ERC20ContractAddr.call();
        assert.equal(erc20Address, BNBToken.address, "swap contract should have erc20 contract address");
    });
    it('Test transfer, approve and transferFrom for BNB token', async () => {
        const bnbInstance = await BNBToken.deployed();
        const acc0 = accounts[0];
        const acc1 = accounts[1];
        const acc2 = accounts[2];
        const acc3 = accounts[3];
        const amount = 1000000000000;

        await bnbInstance.transfer(acc1, amount, { from: acc0 });
        const acc1Balance = (await bnbInstance.balanceOf.call(acc1)).valueOf();
        assert.equal(Number(acc1Balance.toString()), amount, "acc1 balance should be " + amount);

        await bnbInstance.approve(acc2, amount, { from: acc1 });
        await bnbInstance.transferFrom(acc1, acc3, amount, { from: acc2 });

        const balanceAcc1 = (await bnbInstance.balanceOf.call(acc1)).valueOf();
        const balanceAcc2 = (await bnbInstance.balanceOf.call(acc2)).valueOf();
        const balanceAcc3 = (await bnbInstance.balanceOf.call(acc3)).valueOf();

        assert.equal(Number(balanceAcc1.toString()), 0, "acc1 balance should be 0");
        assert.equal(Number(balanceAcc2.toString()), 0, "acc2 balance should be 0");
        assert.equal(Number(balanceAcc3.toString()), amount, "acc3 balance should be " + amount);

        await bnbInstance.approve(acc2, amount, { from: acc0 });
        await bnbInstance.transferFrom(acc0, acc2, amount, { from: acc2 });
        const balanceAcc2_1 = (await bnbInstance.balanceOf.call(acc2)).valueOf();
        assert.equal(Number(balanceAcc2_1.toString()), amount, "acc2 balance should be " + amount);
    });
    it('Test random number hash lock calculation', async () => {
        const swapInstance = await ERC20AtomicSwapper.deployed();

        const timestamp = 1565312187;
        const randomNumber = "0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd";
        const randomNumberHash = (await swapInstance.calRandomNumberHash.call(randomNumber, timestamp));

        assert.equal(randomNumberHash, calculateRandomNumberHash(randomNumber, timestamp), "the randomNumberHash should equal to hash result of randomNumber and timestamp");
    });
    it('Test swap initiate, claim', async () => {
        const swapInstance = await ERC20AtomicSwapper.deployed();
        const bnbInstance = await BNBToken.deployed();

        const swapA = accounts[0];
        const swapB = accounts[4];

        const timestamp = 1565312187; // counted by second
        const randomNumber = "0xaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd";
        const randomNumberHash = calculateRandomNumberHash(randomNumber, timestamp);
        const timelock = 1000;
        const receiverAddr = swapB;
        const bep2Addr = "0xc9a2c4868f0f96faaa739b59934dc9cb304112ec";
        const erc20Amount = 100000000;
        const bep2Amount = 100000000;

        var hashLockable = (await swapInstance.hashLockable.call(randomNumberHash)).valueOf();
        assert.equal(hashLockable, true);

        await bnbInstance.approve(ERC20AtomicSwapper.address, erc20Amount, { from: swapA });
        let initiateTx = await swapInstance.htlt(randomNumberHash, timestamp, timelock, receiverAddr, bep2Addr, erc20Amount, bep2Amount, { from: swapA });
        //SwapInit event should be emitted
        truffleAssert.eventEmitted(initiateTx, 'HTLT', (ev) => {
            return ev._msgSender === swapA &&
                ev._receiverAddr === swapB &&
                ev._bep2Addr === bep2Addr &&
                ev._randomNumberHash === randomNumberHash &&
                Number(ev._timestamp.toString()) === timestamp &&
                Number(ev._outAmount.toString()) === erc20Amount &&
                Number(ev._bep2Amount.toString()) === bep2Amount;
        });
        console.log("initiateTx gasUsed: ", initiateTx.receipt.gasUsed);

        // Verify if the swapped ERC20 token has been transferred to contract address
        var balanceOfSwapContract = await bnbInstance.balanceOf.call(ERC20AtomicSwapper.address);
        assert.equal(Number(balanceOfSwapContract.toString()), erc20Amount);

        // querySwapByHashLock
        var swap = (await swapInstance.queryOpenSwap.call(randomNumberHash)).valueOf();
        assert.equal(timestamp, swap._timestamp);
        assert.equal(swapA, swap._sender);

        hashLockable = (await swapInstance.hashLockable.call(randomNumberHash)).valueOf();
        assert.equal(hashLockable, false);
        var claimable = (await swapInstance.claimable.call(randomNumberHash)).valueOf();
        assert.equal(claimable, true);
        var refundable = (await swapInstance.refundable.call(randomNumberHash)).valueOf();
        assert.equal(refundable, false);

        var balanceOfSwapB = await bnbInstance.balanceOf.call(swapB);
        assert.equal(Number(balanceOfSwapB.toString()), 0);

        // Anyone can call claim and the token will be paid to swapB address
        let claimTx = await swapInstance.claim(randomNumberHash, randomNumber, { from: accounts[6] });
        //SwapComplete n event should be emitted
        truffleAssert.eventEmitted(claimTx, 'Claimed', (ev) => {
            return ev._msgSender === accounts[6] && ev._receiverAddr === swapB && ev._randomNumberHash === randomNumberHash && ev._randomNumber === randomNumber;
        });
        console.log("claimTx gasUsed: ", claimTx.receipt.gasUsed);

        balanceOfSwapB = await bnbInstance.balanceOf.call(swapB);
        assert.equal(Number(balanceOfSwapB.toString()), erc20Amount);

        balanceOfSwapContract = await bnbInstance.balanceOf.call(ERC20AtomicSwapper.address);
        assert.equal(Number(balanceOfSwapContract.toString()), 0);

        claimable = (await swapInstance.claimable.call(randomNumberHash)).valueOf();
        assert.equal(claimable, false);
        refundable = (await swapInstance.refundable.call(randomNumberHash)).valueOf();
        assert.equal(refundable, false);
    });
    it('Test swap initiate, refund', async () => {
        const swapInstance = await ERC20AtomicSwapper.deployed();
        const bnbInstance = await BNBToken.deployed();

        const swapA = accounts[0];
        const swapB = accounts[5];

        const timestamp = 1565312187; // counted by second
        const randomNumber = "0x5566778855667788556677885566778855667788556677885566778855667788";
        const randomNumberHash = calculateRandomNumberHash(randomNumber, timestamp);
        const timelock = 100;
        const receiverAddr = swapB;
        const bep2Addr = "0xc9a2c4868f0f96faaa739b59934dc9cb304112ec";
        const erc20Amount = 100000000;
        const bep2Amount = 100000000;

        var hashLockable = (await swapInstance.hashLockable.call(randomNumberHash)).valueOf();
        assert.equal(hashLockable, true);

        await bnbInstance.approve(ERC20AtomicSwapper.address, erc20Amount, { from: swapA });
        let initiateTx = await swapInstance.htlt(randomNumberHash, timestamp, timelock, receiverAddr, bep2Addr, erc20Amount, bep2Amount, { from: swapA });
        //SwapInit event should be emitted
        truffleAssert.eventEmitted(initiateTx, 'HTLT', (ev) => {
            return ev._msgSender === swapA &&
                ev._receiverAddr === swapB &&
                ev._bep2Addr === bep2Addr &&
                ev._randomNumberHash === randomNumberHash &&
                Number(ev._timestamp.toString()) === timestamp &&
                Number(ev._outAmount.toString()) === erc20Amount &&
                Number(ev._bep2Amount.toString()) === bep2Amount;
        });
        console.log("initiateTx gasUsed: ", initiateTx.receipt.gasUsed);

        hashLockable = (await swapInstance.hashLockable.call(randomNumberHash)).valueOf();
        assert.equal(hashLockable, false);
        var claimable = (await swapInstance.claimable.call(randomNumberHash)).valueOf();
        assert.equal(claimable, true);
        var refundable = (await swapInstance.refundable.call(randomNumberHash)).valueOf();
        assert.equal(refundable, false);


        // Just for producing new blocks
        for (var i = 0; i < timelock; i++) {
            await bnbInstance.transfer(swapA, 10, { from: swapA });
        }

        claimable = (await swapInstance.claimable.call(randomNumberHash)).valueOf();
        assert.equal(claimable, false);
        refundable = (await swapInstance.refundable.call(randomNumberHash)).valueOf();
        assert.equal(refundable, true);

        var balanceOfSwapA = await bnbInstance.balanceOf.call(swapA);
        var balanceOfSwapB = await bnbInstance.balanceOf.call(swapB);
        assert.equal(Number(balanceOfSwapB.toString()), 0);

        // Anyone can call refund and the token will always been refunded to swapA address
        let refundTx = await swapInstance.refund(randomNumberHash, { from: accounts[6] });

        //SwapExpire n event should be emitted
        truffleAssert.eventEmitted(refundTx, 'Refunded', (ev) => {
            return ev._msgSender === accounts[6] && ev._swapSender === swapA && ev._randomNumberHash === randomNumberHash;
        });
        console.log("refundTx gasUsed: ", refundTx.receipt.gasUsed);

        balanceOfSwapB = await bnbInstance.balanceOf.call(swapB);
        assert.equal(Number(balanceOfSwapB.toString()), 0);

        var balanceOfSwapANew = await bnbInstance.balanceOf.call(swapA);
        assert.equal(Number(balanceOfSwapANew.toString()), Number(balanceOfSwapA.toString()) + erc20Amount);

        var balanceOfSwapContract = await bnbInstance.balanceOf.call(ERC20AtomicSwapper.address);
        assert.equal(Number(balanceOfSwapContract.toString()), 0);

        claimable = (await swapInstance.claimable.call(randomNumberHash)).valueOf();
        assert.equal(claimable, false);
        refundable = (await swapInstance.refundable.call(randomNumberHash)).valueOf();
        assert.equal(refundable, false);
    });
});
