var CappedInvestmentFund = artifacts.require("./CappedInvestmentFund.sol");

const makeInvestments = function (instance, investments) {
  var promises = []
  for (var ix in investments) {
    var investment = investments[ix];
    var p = new Promise(function(resolve, reject) {
      instance.invest(investment.multiplier_micro, 0, { from: investment.investor, value: web3.toWei(investment.amount_eth, 'ether') })
      .then(
      function (txn) {
        resolve();
      });
    });
    promises.push(p);
  }

  return Promise.all(promises);
}

const compareInvestments = function(a, b) {
  if (a.multiplier_micro < b.multiplier_micro) {
    return -1;
  }
  if (a.multiplier_micro > b.multiplier_micro) {
    return 1;
  }
  return 0;
}

const getSortedElements = function (getLowestKeyMethod, getElementAtKeyMethod) {
  var array = [];
  return new Promise(function(resolve, reject) {
    getLowestKeyMethod.call().then(
      function(key) {
        if (key > 0) {
          // console.log('first key: ' + key)
          getSortedElementsRec(getElementAtKeyMethod, key, array).then(
            function (array) {
              resolve(array);
            })
        } else {
          resolve([]);
        }
      });
  });
}

const getSortedElementsRec = function (getElementAtKeyMethod, key, array) {
  return new Promise(function(resolve, reject) {
    getElementAtKeyMethod.call(key).then(
      function (res) {

        var element = {
            investor: res[0],
            amount: res[1],
            multiplier_micro: res[2],
            used: res[3],
            filled_micros: res[4],
            paid: res[5]
          }
        array.push(element);

        var nextKey = res[6];
        if (nextKey != 0) {
          /* recursive call filling sortedOffers
          until the end of the list */
          resolve(getSortedElementsRec(getElementAtKeyMethod, nextKey, array));
        } else {
          resolve(array);
        }
      });
    });
};

contract('CappedInvestmentFund', function(accounts) {

  var investmentFund;

  it ("should add a investment in order",

  function() {

    var orderedInvestments = [];
    var investments = [
      {
        investor: accounts[0],
        multiplier_micro: 1100000,
        amount_eth: 1.1
      },
      {
        investor: accounts[1],
        multiplier_micro: 1200000,
        amount_eth: 1.2
      },
      {
        investor: accounts[2],
        multiplier_micro: 900000,
        amount_eth: 1.3
      },
      {
        investor: accounts[3],
        multiplier_micro: 1200000,
        amount_eth: 1.4
      },
      {
        investor: accounts[4],
        multiplier_micro: 1300000,
        amount_eth: 1.5
      } ];
    var investmentsSorted = [];

    var investments2 = [
      {
        investor: accounts[5],
        multiplier_micro: 1100000,
        amount_eth: 1.6
      },
      {
        investor: accounts[6],
        multiplier_micro: 1250000,
        amount_eth: 1.7
      }];
    var remainingOffers = [];
    var remainingSorted = [];
    var totalAvailable = 0;

    console.log('getting instance...');
    return CappedInvestmentFund.deployed()
    .then(

    function(instance) {
      investmentFund = instance;
      console.log('contract address: ' + investmentFund.address);

      console.log('making investments...');
      return makeInvestments(investmentFund, investments);
    }).then(

    function(txn) {
      return getSortedElements(investmentFund.getLowestInvestmentOfferKey, investmentFund.getInvestmentOfferDataAtKey);
    }).then(

    function(sortedOffers) {
      /* check the order is correct */
      // console.log(sortedOffers);
      investmentsSorted = JSON.parse(JSON.stringify(investments));
      investmentsSorted.sort(compareInvestments);

      assert.equal(sortedOffers.length, investmentsSorted.length, "investment number wrong");

      for (var ix in sortedOffers) {
        var offer = sortedOffers[ix];
        assert.equal(offer.investor, investmentsSorted[ix].investor, "investment address wrong");
        assert.equal(offer.multiplier_micro, investmentsSorted[ix].multiplier_micro, "investment multiplier wrong");
        assert.equal(offer.amount, web3.toWei(investmentsSorted[ix].amount_eth, "ether"), "investment amount wrong");
      }

      /* spend 80% of the first investment */
      console.log('spending 80% of first investment...');
      return investmentFund.spend(web3.toWei(investmentsSorted[0].amount_eth*0.8), { from: accounts[0] });

    }).then(

    function(txn) {
      console.log('getting sorted used investments...');
      return getSortedElements(investmentFund.getLowestInvestmentUsedKey, investmentFund.getInvestmentUsedDataAtKey);
    }).then(

    function(usedOffers) {
      // console.dir(usedOffers)
      assert.equal(usedOffers[0].used, web3.toWei(investmentsSorted[0].amount_eth*0.8, 'ether'), "didn't used partially one offer");

      /* spend another 80% of the first investment */
      console.log('spending another 80% of first investment...');
      return investmentFund.spend(web3.toWei(investmentsSorted[0].amount_eth*0.8), { from: accounts[0] });
    }).then(

    function(txn) {
      // console.log('spent again')
      console.log('getting sorted used investments...');
      return getSortedElements(investmentFund.getLowestInvestmentUsedKey, investmentFund.getInvestmentUsedDataAtKey);
    }).catch(function () {
      console.log('error spending another 80%');

    }).then(

    function(usedOffers) {
      // console.dir(usedOffers)

      /* first investment fully used - the 20% missing */
      assert.equal(usedOffers[0].used, web3.toWei(investmentsSorted[0].amount_eth, 'ether'), "error using offer");
      /* second investment used for what was missing - 60% to reach 80% */
      assert.equal(usedOffers[1].used, web3.toWei(investmentsSorted[0].amount_eth*0.6, 'ether'), "error using offer");

      console.log('getting sorted offered investments...');
      return getSortedElements(investmentFund.getLowestInvestmentOfferKey, investmentFund.getInvestmentOfferDataAtKey);
    }).then(

    function (sortedOffers) {

      // console.dir(sortedOffers);
      /* check the first offer was deleted from the offer list */
      // TODO: bug warning, if investor is the same for the two first investments this test might give a false positive.
      assert.equal(sortedOffers.length, investmentsSorted.length - 1, "too many elements");
      assert.notEqual(sortedOffers[0].investor, investmentsSorted[0].investor, "investment not removed from offers");

      /* spend two investments in a row */
      var remaining = investmentsSorted[1].amount_eth - investmentsSorted[0].amount_eth*0.6
      /* spend all what remains from second investments + all third investment + 0.1 eth if the forth investment */
      var spendNow = remaining + investmentsSorted[2].amount_eth + 0.1;

      console.log('spending more than one investment at a time...');
      return investmentFund.spend(web3.toWei(spendNow), { from: accounts[0] });

    }).then (

    function(txn) {
      // console.log('spent again')
      console.log('getting sorted used investments...');
      return getSortedElements(investmentFund.getLowestInvestmentUsedKey, investmentFund.getInvestmentUsedDataAtKey);
    }).then(

    function(usedOffers) {
      // console.dir(usedOffers)

      assert.equal(usedOffers[0].used, web3.toWei(investmentsSorted[0].amount_eth, 'ether'), "error using offer");
      assert.equal(usedOffers[1].used, web3.toWei(investmentsSorted[1].amount_eth, 'ether'), "error using offer");
      assert.equal(usedOffers[2].used, web3.toWei(investmentsSorted[2].amount_eth, 'ether'), "error using offer");
      assert.equal(usedOffers[3].used, web3.toWei(0.1, 'ether'), "error using offer");

      console.log('getting sorted offered investments...');
      return getSortedElements(investmentFund.getLowestInvestmentOfferKey, investmentFund.getInvestmentOfferDataAtKey);
    }).then(

    function (sortedOffers) {
      // console.dir(sortedOffers)
      assert.equal(sortedOffers.length, investmentsSorted.length - 3, "too many elements");

      remainingOffers = [];

      for (var ix in sortedOffers) {
        remainingOffers.push({
          investor: sortedOffers[ix].investor,
          amount_eth: Number(web3.fromWei(sortedOffers[ix].amount, "ether")),
          multiplier_micro: Number(sortedOffers[ix].multiplier_micro)
        })
      }

      /* lets now make another investment */
      console.log('making second row of investments...');
      return makeInvestments(investmentFund, investments2);
    }).then(

    function (txt) {
      console.log('getting sorted offered investments...');
      return getSortedElements(investmentFund.getLowestInvestmentOfferKey, investmentFund.getInvestmentOfferDataAtKey);
    }).then(

    function (sortedOffers) {
      // console.log(investmentsOffersNow)

      remainingSorted = JSON.parse(JSON.stringify(remainingOffers.concat(investments2)));
      remainingSorted.sort(compareInvestments);

      for (var ix in sortedOffers) {
        var offer = sortedOffers[ix];
        assert.equal(offer.investor, remainingSorted[ix].investor, "investment address wrong");
        assert.equal(offer.multiplier_micro, remainingSorted[ix].multiplier_micro, "investment multiplier wrong");
        assert.equal(offer.amount, web3.toWei(remainingSorted[ix].amount_eth, "ether"), "investment amount wrong");
      }

      /* now lets try to spend more than what is totally available */
      totalAvailable = 0;
      sortedOffers.forEach(function(investment) {
        totalAvailable += Number(web3.fromWei(investment.amount - investment.used), "ether");
      })

      console.log('spending more than what is totally available...');
      return investmentFund.spend(web3.toWei(totalAvailable + 1), { from: accounts[0] });
    }).catch(

    /* TODO: This catch catches all exceptions hapenign avo */
    function (txt) {
      /* now spend almost all the funds */
      console.log('spending almost all of what is totally available...');
      return investmentFund.spend(web3.toWei(totalAvailable - 0.1), { from: accounts[0] });
    }).then(

    function (txn) {
      console.log('getting sorted used investments...');
      return getSortedElements(investmentFund.getLowestInvestmentUsedKey, investmentFund.getInvestmentUsedDataAtKey);
    }).then(

    function (sortedUsed) {
      // console.dir(sortedUsed)

      var investmentUsedRef = investmentsSorted.slice(0, 4).concat(remainingSorted);
      assert.equal(sortedUsed.length, investmentUsedRef.length, "unexpected number of used investments");

      for (var ix in sortedUsed) {
        assert.equal(sortedUsed[ix].investor, investmentUsedRef[ix].investor, "investment address wrong");
        assert.equal(sortedUsed[ix].multiplier_micro, investmentUsedRef[ix].multiplier_micro, "investment multiplier wrong");
        assert.equal(sortedUsed[ix].amount, web3.toWei(investmentUsedRef[ix].amount_eth, "ether"), "investment amount wrong");
      }

      for (var ix in sortedUsed) {
        /* all elements used, expect the last one*/
        if (ix < (sortedUsed.length - 1)) {
          assert.equal(sortedUsed[ix].amount.toString(), sortedUsed[ix].used.toString(), "investment amount used wrong");
        }
      }

      /* now lets receive some revenue */
      console.log('sending revenue');
      return web3.eth.sendTransaction({from: accounts[5], value: web3.toWei(1, "ether")});
    }).then(

    function (txn) {
      console.dir(txn);
      console.log('getting sorted used investments...');
      return getSortedElements(investmentFund.getLowestInvestmentUsedKey, investmentFund.getInvestmentUsedDataAtKey);
    }).then(

    function (sortedUsed) {
      // console.dir(sortedUsed);
    });
  });
});
