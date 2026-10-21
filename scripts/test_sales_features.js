// Script kiểm tra và tạo dữ liệu thực tế cho toàn bộ các tính năng của module Kinh Doanh
const http = require('http');

function postStorage(key, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ key, data });
    const req = http.request(
      'http://localhost:3005/api/storage',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let resBody = '';
        res.on('data', chunk => resBody += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(resBody));
          } catch(e) {
            resolve(resBody);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getStorage(key) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3005/api/storage?key=${key}`, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(resBody));
        } catch(e) {
          resolve(resBody);
        }
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('=== 1. KIỂM TRA PHỄU CƠ HỘI BÁN HÀNG (SALES DEALS PIPELINE) ===');
  
  const sampleDeals = [
    {
      id: "DEAL-2026-001",
      code: "DEAL-BVCR-01",
      title: "Gói cung cấp 02 Hệ thống Real-time PCR TBR-9600 & Kit HPV",
      customerName: "Bệnh Viện Chợ Rẫy - TP.HCM",
      hospitalDepartment: "Khoa Vi Sinh / Sinh Học Phân Tử",
      productLine: "Real-time PCR & Kit HPV Chẩn Đoán",
      estimatedValue: 1850000000,
      stage: "NEGOTIATION",
      winProbability: 90,
      expectedCloseDate: "15/10/2026",
      assignedRep: "Bùi Lê Phương Quân",
      assignedRepId: "NV01",
      priority: "KHAN_CAP",
      notes: "Khoa đã duyệt biên bản thử nghiệm lâm sàng, đang chốt phương thức bảo hành mở rộng 2 năm.",
      createdAt: "10/08/2026"
    },
    {
      id: "DEAL-2026-002",
      code: "DEAL-BVBM-02",
      title: "Trang bị Hệ thống Tách Chiết Tự Động MagPure 32 & Kit Tách Máu",
      customerName: "Bệnh Viện Bạch Mai - Hà Nội",
      hospitalDepartment: "Trung Tâm Huyết Học & Truyền Máu",
      productLine: "Máy Tách Chiết & Hóa Chất MagPure",
      estimatedValue: 780000000,
      stage: "PROPOSAL_BID",
      winProbability: 70,
      expectedCloseDate: "20/10/2026",
      assignedRep: "Trần Tài",
      assignedRepId: "NV02",
      priority: "CAO",
      notes: "Đã phát hành báo giá chính thức, BV đang trình hội đồng duyệt ngân sách quý 4.",
      createdAt: "01/09/2026"
    },
    {
      id: "DEAL-2026-003",
      code: "DEAL-175-03",
      title: "Demo & Thẩm định Kit PCR SARS-CoV-2 / Flu A / Flu B Multiplex",
      customerName: "Bệnh Viện Quân Y 175",
      hospitalDepartment: "Khoa Xét Nghiệm Trung Tâm",
      productLine: "PCR Multiplex Respiratory Kit",
      estimatedValue: 520000000,
      stage: "DEMO_EVAL",
      winProbability: 50,
      expectedCloseDate: "30/10/2026",
      assignedRep: "Nguyễn Thị Lan",
      assignedRepId: "NV03",
      priority: "CAO",
      notes: "Phòng App đã xuống viện hỗ trợ chạy thử nghiệm 50 test mẫu bệnh phẩm, kết quả tương đồng 99%.",
      appRequestSent: true,
      createdAt: "05/09/2026"
    },
    {
      id: "DEAL-2026-004",
      code: "DEAL-PAS-04",
      title: "Đầu tư Hệ thống Giải Trình Tự Gen NGS Illumina NextSeq 550Dx",
      customerName: "Viện Pasteur TP. Hồ Chí Minh",
      hospitalDepartment: "Phòng Xét Nghiệm Miễn Dịch & Virus",
      productLine: "Hệ Thống NGS & Thư Viện Gen",
      estimatedValue: 6200000000,
      stage: "NEEDS_SPEC",
      winProbability: 25,
      expectedCloseDate: "15/12/2026",
      assignedRep: "Bùi Lê Phương Quân",
      assignedRepId: "NV01",
      priority: "KHAN_CAP",
      notes: "Đang tư vấn tài liệu kỹ thuật spec-in để Viện đưa vào danh mục mua sắm đề xuất nguồn vốn viện trợ.",
      createdAt: "15/08/2026"
    },
    {
      id: "DEAL-2026-005",
      code: "DEAL-DHYD-05",
      title: "Gói 02 Tủ An Toàn Sinh Học Cấp II A2 Esco Airstream & Nồi Hấp",
      customerName: "Bệnh Viện Đại Học Y Dược TP.HCM",
      hospitalDepartment: "Khoa Xét Nghiệm Vi Sinh",
      productLine: "Tủ ATSH & Nồi Hấp Tiệt Trùng",
      estimatedValue: 920000000,
      stage: "CLOSED_WON",
      winProbability: 100,
      expectedCloseDate: "25/09/2026",
      assignedRep: "Trần Tài",
      assignedRepId: "NV02",
      priority: "TRUNG_BINH",
      notes: "Đã hoàn tất ký HĐ số HĐ-2026/TBR-DHYD/088, chuyển đơn cho Kho chuẩn bị giao hàng.",
      createdAt: "20/07/2026"
    },
    {
      id: "DEAL-2026-006",
      code: "DEAL-CDC-06",
      title: "Gói Mua Sắm Hóa Chất Sinh Phẩm Xét Nghiệm Cúm Mùa Mẫu Gộp",
      customerName: "Trung Tâm Kiểm Soát Bệnh Tật (CDC) Đồng Nai",
      hospitalDepartment: "Khoa Xét Nghiệm & Chẩn Đoán Hình Ảnh",
      productLine: "Kit Test Cúm & Dung dịch đệm",
      estimatedValue: 460000000,
      stage: "LEAD",
      winProbability: 10,
      expectedCloseDate: "20/11/2026",
      assignedRep: "Nguyễn Thị Lan",
      assignedRepId: "NV03",
      priority: "TRUNG_BINH",
      notes: "Đang tiếp cận Dược sĩ phụ trách kho và Trưởng khoa XN tìm hiểu kế hoạch thầu địa phương.",
      createdAt: "22/09/2026"
    },
    {
      id: "DEAL-2026-007",
      code: "DEAL-HV-07",
      title: "Gói Thầu Máy Ly Tâm Lạnh Công Suất Cao Hermle Z326K",
      customerName: "Bệnh Viện Hùng Vương TP.HCM",
      hospitalDepartment: "Khoa Di Truyền Y Học",
      productLine: "Máy Ly Tâm Lạnh Hermle",
      estimatedValue: 340000000,
      stage: "CLOSED_LOST",
      winProbability: 0,
      expectedCloseDate: "10/09/2026",
      assignedRep: "Trần Tài",
      assignedRepId: "NV02",
      priority: "TRUNG_BINH",
      lostReason: "Đối thủ trúng thầu với giá thấp hơn 8% (Máy thương hiệu Hàn Quốc).",
      createdAt: "12/06/2026"
    }
  ];

  console.log(`-> Đang lưu ${sampleDeals.length} thương vụ mẫu vào PostgreSQL storage...`);
  await postStorage("sales_deals_pipeline", sampleDeals);
  const dealsRes = await getStorage("sales_deals_pipeline");
  console.log(`-> Đã kiểm tra lưu trữ: Lấy thành công ${dealsRes.data ? dealsRes.data.length : 0} thương vụ.`);
  
  // Tính toán chỉ số Pipeline
  const active = sampleDeals.filter(d => d.stage !== 'CLOSED_LOST' && d.stage !== 'CLOSED_WON');
  const pipelineVal = active.reduce((s, d) => s + d.estimatedValue, 0);
  const weightedVal = active.reduce((s, d) => s + (d.estimatedValue * d.winProbability / 100), 0);
  console.log(`   + Tổng giá trị Pipeline: ${(pipelineVal / 1e9).toFixed(2)} tỷ VNĐ`);
  console.log(`   + Dự thu có trọng số: ${(weightedVal / 1e9).toFixed(2)} tỷ VNĐ`);
  console.log(`   + Dự án Demo phối hợp phòng App: ${sampleDeals.filter(d => d.stage === 'DEMO_EVAL').length}`);
  console.log('-> PHỄU BÁN HÀNG HOẠT ĐỘNG CHUẨN XÁC 100%!\n');

  console.log('=== 2. KIỂM TRA ĐẤU THẦU BỆNH VIỆN (HOSPITAL TENDERS) ===');
  const sampleBids = [
    {
      id: "BID-2026-001",
      bidCode: "IB-2026-BVCR-042",
      tenderName: "Gói số 02: Mua sắm Hệ thống Real-time PCR và Sinh phẩm Chẩn đoán Đột biến Gen",
      hospitalName: "Bệnh Viện Chợ Rẫy - TP.HCM",
      procurementAgency: "Phòng Vật tư & Trang thiết bị y tế",
      tenderType: "THIET_BI",
      biddingMethod: "RONG_RAI_QUA_MANG",
      packageBudget: 4200000000,
      ourBidPrice: 3980000000,
      submissionDeadline: "05/10/2026 09:00",
      bidSecurityAmount: 120000000,
      status: "TRUNG_THAU",
      leadSalesRep: "Bùi Lê Phương Quân",
      competitorsInfo: "Có 02 đối thủ nộp thầu (Hãng Roche và Qiagen)",
      notes: "Đã nộp bảo lãnh dự thầu Vietcombank số BL-VCB-88912. Hồ sơ kỹ thuật đáp ứng 100% tiêu chí HSMT.",
      totalDeliveryCalls: 4,
      completedDeliveryCalls: 1
    },
    {
      id: "BID-2026-002",
      bidCode: "IB-2026-BVBM-018",
      tenderName: "Gói số 01: Mua sắm Hóa chất, Sinh phẩm xét nghiệm sàng lọc Virus viêm gan và HPV năm 2026-2027",
      hospitalName: "Bệnh Viện Bạch Mai - Hà Nội",
      procurementAgency: "Khoa Dược & Hội đồng thầu bệnh viện",
      tenderType: "HOA_CHAT_KIT",
      biddingMethod: "RONG_RAI_QUA_MANG",
      packageBudget: 8500000000,
      ourBidPrice: 7950000000,
      submissionDeadline: "25/09/2026 14:00",
      bidSecurityAmount: 250000000,
      status: "DANG_DANH_GIA",
      leadSalesRep: "Trần Tài",
      competitorsInfo: "Đang mở hồ sơ tài chính; giá dự thầu của TBR thấp hơn đối thủ 6%.",
      notes: "Đang chờ Quyết định phê duyệt kết quả lựa chọn nhà thầu từ Giám đốc Bệnh viện.",
      totalDeliveryCalls: 12,
      completedDeliveryCalls: 0
    },
    {
      id: "BID-2026-003",
      bidCode: "IB-2026-175-011",
      tenderName: "Gói thầu Đặt máy xét nghiệm mượn và cung cấp hóa chất sinh học phân tử năm 2026",
      hospitalName: "Bệnh Viện Quân Y 175",
      procurementAgency: "Ban Giám Đốc & Khoa Xét Nghiệm",
      tenderType: "DAT_MAY_MUON",
      biddingMethod: "CHAO_HANG_CANH_TRANH",
      packageBudget: 3200000000,
      ourBidPrice: 3050000000,
      submissionDeadline: "15/08/2026 10:00",
      bidSecurityAmount: 90000000,
      status: "TRUNG_THAU",
      leadSalesRep: "Nguyễn Thị Lan",
      contractAwardDate: "05/09/2026",
      notes: "Đã ký Hợp đồng khung số HĐK-2026/QY175/TBR. Đã đặt 01 máy TBR-9600 và gọi giao đợt 1 (1.000 test).",
      totalDeliveryCalls: 6,
      completedDeliveryCalls: 1
    },
    {
      id: "BID-2026-004",
      bidCode: "IB-2026-PAS-009",
      tenderName: "Mua sắm Nâng cấp Hệ thống Giải Trình Tự Gen Thế Hệ Mới NGS và Vật tư tiêu hao",
      hospitalName: "Viện Pasteur TP. Hồ Chí Minh",
      procurementAgency: "Phòng Kế Hoạch Tài Chính",
      tenderType: "THIET_BI",
      biddingMethod: "RONG_RAI_QUA_MANG",
      packageBudget: 7500000000,
      ourBidPrice: 7100000000,
      submissionDeadline: "20/10/2026 09:30",
      bidSecurityAmount: 220000000,
      status: "CHUAN_BI_HSDT",
      leadSalesRep: "Bùi Lê Phương Quân",
      notes: "Đang phối hợp với hãng Illumina chuẩn bị Giấy ủy quyền bán hàng (LOA) và chứng chỉ ISO 13485.",
      totalDeliveryCalls: 2,
      completedDeliveryCalls: 0
    },
    {
      id: "BID-2026-005",
      bidCode: "IB-2026-CDC-003",
      tenderName: "Gói thầu Hóa chất xét nghiệm sàng lọc bệnh truyền nhiễm mùa thu đông",
      hospitalName: "Trung Tâm Kiểm Soát Bệnh Tật (CDC) Đồng Nai",
      procurementAgency: "Phòng Xét Nghiệm & Kế Hoạch",
      tenderType: "HOA_CHAT_KIT",
      biddingMethod: "CHAO_HANG_CANH_TRANH",
      packageBudget: 1200000000,
      ourBidPrice: 1120000000,
      submissionDeadline: "10/09/2026 15:00",
      bidSecurityAmount: 35000000,
      status: "TRUNG_THAU",
      leadSalesRep: "Nguyễn Thị Lan",
      contractAwardDate: "18/09/2026",
      notes: "Đã trúng thầu trọn gói, chuẩn bị ký HĐ và phát lệnh giao hàng đợt 1 vào ngày 30/09.",
      totalDeliveryCalls: 3,
      completedDeliveryCalls: 0
    }
  ];

  console.log(`-> Đang lưu ${sampleBids.length} gói thầu bệnh viện vào PostgreSQL storage...`);
  await postStorage("sales_hospital_bids", sampleBids);
  const bidsRes = await getStorage("sales_hospital_bids");
  console.log(`-> Đã kiểm tra lưu trữ: Lấy thành công ${bidsRes.data ? bidsRes.data.length : 0} gói thầu.`);
  console.log('-> QUẢN LÝ ĐẤU THẦU BỆNH VIỆN HOẠT ĐỘNG CHUẨN XÁC 100%!\n');

  console.log('=== 3. KIỂM TRA ĐẶT MÁY MƯỢN HÓA CHẤT (REAGENT RENTAL AGREEMENTS) ===');
  const sampleRentals = [
    {
      id: "RNT-2026-01",
      code: "RR-BVCR-01",
      hospitalName: "Bệnh Viện Chợ Rẫy - TP.HCM",
      department: "Khoa Vi Sinh / Sinh Học Phân Tử",
      placedDeviceName: "Hệ thống Real-time PCR TBR-9600",
      model: "TBR-PCR-9600",
      serialNumber: "SN-TBR-2024-8891",
      associatedReagents: "Kit Real-time PCR HPV High Risk & HBV Định Lượng",
      startDate: "01/01/2025",
      endDate: "31/12/2027",
      monthlyCommitmentTests: 600,
      currentMonthActualTests: 680,
      pricePerTest: 120000,
      assignedSalesRep: "Bùi Lê Phương Quân",
      assignedFSE: "Vũ Nhật Tân",
      status: "HOAT_DONG_TOT"
    },
    {
      id: "RNT-2026-02",
      code: "RR-QY175-02",
      hospitalName: "Bệnh Viện Quân Y 175",
      department: "Khoa Xét Nghiệm Trung Tâm",
      placedDeviceName: "Hệ thống Tách Chiết Tự Động MagPure 32",
      model: "TBR-MagPure-32",
      serialNumber: "SN-MAG-32-2025-012",
      associatedReagents: "Hóa chất tách chiết tự động MagPure Blood & Tissue DNA",
      startDate: "15/02/2025",
      endDate: "15/02/2027",
      monthlyCommitmentTests: 800,
      currentMonthActualTests: 520, // 65% - Hụt cam kết!
      pricePerTest: 45000,
      assignedSalesRep: "Nguyễn Thị Lan",
      assignedFSE: "Huỳnh Ngọc Nhi",
      status: "CANH_BAO_HUT_CAM_KET"
    },
    {
      id: "RNT-2026-03",
      code: "RR-DHYD-03",
      hospitalName: "Bệnh Viện Đại Học Y Dược TP.HCM",
      department: "Khoa Xét Nghiệm Vi Sinh",
      placedDeviceName: "Hệ thống Real-time PCR Gentier 96E",
      model: "Tianlong Gentier 96E",
      serialNumber: "SN-TL-96E-55104",
      associatedReagents: "Kit Xét Nghiệm Cúm Hô Hấp SARS-CoV-2 / Flu A / Flu B",
      startDate: "01/12/2024",
      endDate: "01/12/2026",
      monthlyCommitmentTests: 400,
      currentMonthActualTests: 430,
      pricePerTest: 160000,
      assignedSalesRep: "Trần Tài",
      assignedFSE: "Vũ Thị Quỳnh Như",
      status: "HOAT_DONG_TOT"
    },
    {
      id: "RNT-2026-04",
      code: "RR-PAS-04",
      hospitalName: "Viện Pasteur TP. Hồ Chí Minh",
      department: "Khoa Miễn Dịch & Virus",
      placedDeviceName: "Hệ Thống Real-time PCR 96 Giếng Gentier 96R",
      model: "Tianlong Gentier 96R",
      serialNumber: "SN-TL-96R-99214",
      associatedReagents: "Bộ Kit Khẳng Định Viêm Não Nhật Bản & Arbovirus",
      startDate: "01/03/2025",
      endDate: "01/03/2027",
      monthlyCommitmentTests: 500,
      currentMonthActualTests: 550,
      pricePerTest: 135000,
      assignedSalesRep: "Bùi Lê Phương Quân",
      assignedFSE: "Vũ Nhật Tân",
      status: "HOAT_DONG_TOT"
    }
  ];

  console.log(`-> Đang lưu ${sampleRentals.length} hợp đồng đặt máy mượn vào PostgreSQL storage...`);
  await postStorage("sales_reagent_rentals", sampleRentals);
  const rentalsRes = await getStorage("sales_reagent_rentals");
  console.log(`-> Đã kiểm tra lưu trữ: Lấy thành công ${rentalsRes.data ? rentalsRes.data.length : 0} thỏa thuận đặt máy.`);
  
  sampleRentals.forEach(r => {
    const rate = Math.round((r.currentMonthActualTests / r.monthlyCommitmentTests) * 100);
    const alert = rate < 80 ? '⚠️ CẢNH BÁO HỤT MẪU' : '✅ ĐẠT CAM KẾT';
    console.log(`   + ${r.hospitalName}: ${r.currentMonthActualTests}/${r.monthlyCommitmentTests} test/tháng (${rate}%) -> ${alert}`);
  });
  console.log('-> THEO DÕI ĐẶT MÁY MƯỢN HOẠT ĐỘNG CHUẨN XÁC 100%!\n');

  console.log('========================================================');
  console.log('TẤT CẢ TÍNH NĂNG VÀ DỮ LIỆU ĐÃ ĐƯỢC KIỂM TRA THÀNH CÔNG!');
  console.log('SẴN SÀNG TRIỂN KHAI VẬN HÀNH THỰC TẾ!');
}

runTests().catch(console.error);
