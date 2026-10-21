const fs = require('fs');
const path = require('path');

// 2. Clean SalesDealsPipeline.tsx
const sdpPath = path.join(__dirname, '..', 'src', 'components', 'SalesDealsPipeline.tsx');
let sdp = fs.readFileSync(sdpPath, 'utf8');

const sdpRegex = /const \[deals, setDeals\] = useState<SalesDeal\[\]>\(\[\s*\{[\s\S]*?\n\s*\]\);/;
if (sdpRegex.test(sdp)) {
  sdp = sdp.replace(sdpRegex, 'const [deals, setDeals] = useState<SalesDeal[]>([]);');
  console.log('Updated deals in SalesDealsPipeline.tsx');
  fs.writeFileSync(sdpPath, sdp, 'utf8');
} else {
  console.log('Could not find deals in SalesDealsPipeline.tsx');
}

// 3. Clean HospitalBiddingManagement.tsx
const hbmPath = path.join(__dirname, '..', 'src', 'components', 'HospitalBiddingManagement.tsx');
let hbm = fs.readFileSync(hbmPath, 'utf8');

const tendersRegex = /const \[tenders, setTenders\] = useState<HospitalTender\[\]>\(\[\s*\{[\s\S]*?\n\s*\]\);/;
if (tendersRegex.test(hbm)) {
  hbm = hbm.replace(tendersRegex, 'const [tenders, setTenders] = useState<HospitalTender[]>([]);');
  console.log('Updated tenders in HospitalBiddingManagement.tsx');
} else {
  console.log('Could not find tenders in HospitalBiddingManagement.tsx');
}

const rentalsRegex = /const \[rentals, setRentals\] = useState<ReagentRentalAgreement\[\]>\(\[\s*\{[\s\S]*?\n\s*\]\);/;
if (rentalsRegex.test(hbm)) {
  hbm = hbm.replace(rentalsRegex, 'const [rentals, setRentals] = useState<ReagentRentalAgreement[]>([]);');
  console.log('Updated rentals in HospitalBiddingManagement.tsx');
} else {
  console.log('Could not find rentals in HospitalBiddingManagement.tsx');
}
fs.writeFileSync(hbmPath, hbm, 'utf8');

// 4. Clean LegalModule.tsx
const lmPath = path.join(__dirname, '..', 'src', 'components', 'LegalModule.tsx');
let lm = fs.readFileSync(lmPath, 'utf8');

const legalContractsRegex = /const \[contracts, setContracts\] = useState<LegalContract\[\]>\(\[\s*\{[\s\S]*?\n\s*\]\);/;
if (legalContractsRegex.test(lm)) {
  lm = lm.replace(legalContractsRegex, 'const [contracts, setContracts] = useState<LegalContract[]>([]);');
  console.log('Updated contracts in LegalModule.tsx');
} else {
  console.log('Could not find contracts in LegalModule.tsx');
}

const legalLicensesRegex = /const \[licenses, setLicenses\] = useState<MedicalLicense\[\]>\(\[\s*\{[\s\S]*?\n\s*\]\);/;
if (legalLicensesRegex.test(lm)) {
  lm = lm.replace(legalLicensesRegex, 'const [licenses, setLicenses] = useState<MedicalLicense[]>([]);');
  console.log('Updated licenses in LegalModule.tsx');
} else {
  console.log('Could not find licenses in LegalModule.tsx');
}

const legalTendersRegex = /const \[tenders, setTenders\] = useState<TenderDossier\[\]>\(\[\s*\{[\s\S]*?\n\s*\]\);/;
if (legalTendersRegex.test(lm)) {
  lm = lm.replace(legalTendersRegex, 'const [tenders, setTenders] = useState<TenderDossier[]>([]);');
  console.log('Updated tenders in LegalModule.tsx');
} else {
  console.log('Could not find tenders in LegalModule.tsx');
}
fs.writeFileSync(lmPath, lm, 'utf8');
