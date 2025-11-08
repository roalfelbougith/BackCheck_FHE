import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface BackgroundCheck {
  id: number;
  name: string;
  candidateId: string;
  position: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  status?: string;
}

interface CheckStats {
  totalChecks: number;
  passed: number;
  failed: number;
  pending: number;
  avgScore: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [checks, setChecks] = useState<BackgroundCheck[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingCheck, setCreatingCheck] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newCheckData, setNewCheckData] = useState({ name: "", candidateId: "", position: "", riskScore: "" });
  const [selectedCheck, setSelectedCheck] = useState<BackgroundCheck | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [userHistory, setUserHistory] = useState<BackgroundCheck[]>([]);
  const [stats, setStats] = useState<CheckStats>({ totalChecks: 0, passed: 0, failed: 0, pending: 0, avgScore: 0 });
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed." 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const checksList: BackgroundCheck[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const decryptedValue = Number(businessData.decryptedValue) || 0;
          const status = businessData.isVerified ? 
            (decryptedValue >= 70 ? "passed" : "failed") : "pending";
            
          checksList.push({
            id: parseInt(businessId.replace('check-', '')) || Date.now(),
            name: businessData.name,
            candidateId: businessId,
            position: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: decryptedValue,
            status: status
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setChecks(checksList);
      updateStats(checksList);
      if (address) {
        setUserHistory(checksList.filter(check => check.creator.toLowerCase() === address.toLowerCase()));
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (checksList: BackgroundCheck[]) => {
    const total = checksList.length;
    const passed = checksList.filter(c => c.status === "passed").length;
    const failed = checksList.filter(c => c.status === "failed").length;
    const pending = checksList.filter(c => c.status === "pending").length;
    const avgScore = checksList.length > 0 ? 
      checksList.reduce((sum, c) => sum + (c.decryptedValue || 0), 0) / checksList.length : 0;
    
    setStats({ totalChecks: total, passed, failed, pending, avgScore });
  };

  const createCheck = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingCheck(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating background check with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const riskScore = parseInt(newCheckData.riskScore) || 0;
      const businessId = `check-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, riskScore);
      
      const tx = await contract.createBusinessData(
        businessId,
        newCheckData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newCheckData.position
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Background check created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewCheckData({ name: "", candidateId: "", position: "", riskScore: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingCheck(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Risk score decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const filteredChecks = checks.filter(check => {
    const matchesSearch = check.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         check.position.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === "all" || check.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const renderStatsDashboard = () => {
    return (
      <div className="stats-dashboard">
        <div className="stat-card gold-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Total Checks</h3>
            <div className="stat-value">{stats.totalChecks}</div>
          </div>
        </div>
        
        <div className="stat-card silver-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h3>Passed</h3>
            <div className="stat-value">{stats.passed}</div>
          </div>
        </div>
        
        <div className="stat-card bronze-card">
          <div className="stat-icon">❌</div>
          <div className="stat-content">
            <h3>Failed</h3>
            <div className="stat-value">{stats.failed}</div>
          </div>
        </div>
        
        <div className="stat-card copper-card">
          <div className="stat-icon">⏳</div>
          <div className="stat-content">
            <h3>Pending</h3>
            <div className="stat-value">{stats.pending}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderComplianceChart = (check: BackgroundCheck) => {
    const score = check.decryptedValue || 0;
    const isPass = score >= 70;
    
    return (
      <div className="compliance-chart">
        <div className="score-display">
          <div className="score-circle">
            <div className="score-value">{score}</div>
            <div className="score-label">Risk Score</div>
          </div>
          <div className="verification-badge">
            {check.isVerified ? "✅ On-chain Verified" : "🔒 Encrypted"}
          </div>
        </div>
        
        <div className="threshold-bar">
          <div className="threshold-labels">
            <span>High Risk</span>
            <span>Low Risk</span>
          </div>
          <div className="bar-container">
            <div 
              className={`risk-indicator ${isPass ? 'pass' : 'fail'}`}
              style={{ width: `${score}%` }}
            ></div>
          </div>
          <div className="threshold-line" style={{ left: '70%' }}></div>
        </div>
        
        <div className="result-panel">
          <h4>Compliance Result: <span className={isPass ? "pass-text" : "fail-text"}>
            {isPass ? "PASSED" : "FAILED"}
          </span></h4>
          <p>Threshold: 70+ required for employment</p>
        </div>
      </div>
    );
  };

  const renderUserHistory = () => {
    if (userHistory.length === 0) return null;
    
    return (
      <div className="user-history-panel">
        <h3>Your Recent Checks</h3>
        <div className="history-list">
          {userHistory.slice(0, 3).map((check, index) => (
            <div key={index} className="history-item">
              <div className="history-name">{check.name}</div>
              <div className={`history-status ${check.status}`}>
                {check.status?.toUpperCase()}
              </div>
              <div className="history-date">
                {new Date(check.timestamp * 1000).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 FHE Background Check</h1>
            <p>Confidential Employment Screening</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content metal-frame">
            <div className="connection-icon">🔒</div>
            <h2>Secure Background Verification</h2>
            <p>Connect your wallet to access the encrypted background check system</p>
            <div className="security-features">
              <div className="feature">
                <span className="feature-icon">⚡</span>
                <span>FHE Encrypted Data Processing</span>
              </div>
              <div className="feature">
                <span className="feature-icon">🔍</span>
                <span>Compliant Employment Screening</span>
              </div>
              <div className="feature">
                <span className="feature-icon">📋</span>
                <span>On-chain Verification Records</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing background check data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner metal-spinner"></div>
      <p>Loading encrypted verification system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header metal-header">
        <div className="logo">
          <h1>🔐 FHE Background Check</h1>
          <p>Confidential Employment Screening</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn"
          >
            + New Background Check
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Background Check Analytics</h2>
          {renderStatsDashboard()}
          {renderUserHistory()}
        </div>
        
        <div className="checks-section">
          <div className="section-header metal-panel">
            <h2>Employment Screening Records</h2>
            <div className="controls-group">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search candidates..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="metal-input"
                />
              </div>
              <select 
                value={filterStatus} 
                onChange={(e) => setFilterStatus(e.target.value)}
                className="metal-select"
              >
                <option value="all">All Status</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
              <button 
                onClick={loadData} 
                className="refresh-btn metal-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="checks-list">
            {filteredChecks.length === 0 ? (
              <div className="no-checks metal-panel">
                <p>No background checks found</p>
                <button 
                  className="create-btn metal-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Check
                </button>
              </div>
            ) : filteredChecks.map((check, index) => (
              <div 
                className={`check-item metal-card ${selectedCheck?.id === check.id ? "selected" : ""} ${check.status}`} 
                key={index}
                onClick={() => setSelectedCheck(check)}
              >
                <div className="check-header">
                  <div className="candidate-name">{check.name}</div>
                  <div className={`status-badge ${check.status}`}>
                    {check.status?.toUpperCase()}
                  </div>
                </div>
                <div className="check-details">
                  <span>Position: {check.position}</span>
                  <span>Date: {new Date(check.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="check-footer">
                  <div className="creator">By: {check.creator.substring(0, 6)}...{check.creator.substring(38)}</div>
                  {check.isVerified && (
                    <div className="score">Score: {check.decryptedValue}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateCheck 
          onSubmit={createCheck} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingCheck} 
          checkData={newCheckData} 
          setCheckData={setNewCheckData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedCheck && (
        <CheckDetailModal 
          check={selectedCheck} 
          onClose={() => setSelectedCheck(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(selectedCheck.candidateId)}
          renderComplianceChart={renderComplianceChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-frame">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateCheck: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  checkData: any;
  setCheckData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, checkData, setCheckData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'riskScore') {
      const intValue = value.replace(/[^\d]/g, '');
      setCheckData({ ...checkData, [name]: intValue });
    } else {
      setCheckData({ ...checkData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-check-modal metal-panel">
        <div className="modal-header">
          <h2>New Background Check</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-frame">
            <strong>FHE 🔐 Encryption</strong>
            <p>Risk score will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Candidate Name *</label>
            <input 
              type="text" 
              name="name" 
              value={checkData.name} 
              onChange={handleChange} 
              placeholder="Enter candidate name..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Position Applied *</label>
            <input 
              type="text" 
              name="position" 
              value={checkData.position} 
              onChange={handleChange} 
              placeholder="Enter position..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Risk Score (0-100) *</label>
            <input 
              type="number" 
              name="riskScore" 
              min="0" 
              max="100" 
              value={checkData.riskScore} 
              onChange={handleChange} 
              placeholder="Enter risk score..." 
              className="metal-input"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !checkData.name || !checkData.position || !checkData.riskScore} 
            className="submit-btn metal-btn primary"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Check"}
          </button>
        </div>
      </div>
    </div>
  );
};

const CheckDetailModal: React.FC<{
  check: BackgroundCheck;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderComplianceChart: (check: BackgroundCheck) => JSX.Element;
}> = ({ check, onClose, isDecrypting, decryptData, renderComplianceChart }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="check-detail-modal metal-panel">
        <div className="modal-header">
          <h2>Background Check Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="check-info metal-frame">
            <div className="info-row">
              <span>Candidate Name:</span>
              <strong>{check.name}</strong>
            </div>
            <div className="info-row">
              <span>Position:</span>
              <strong>{check.position}</strong>
            </div>
            <div className="info-row">
              <span>Check Date:</span>
              <strong>{new Date(check.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-row">
              <span>Initiated By:</span>
              <strong>{check.creator.substring(0, 6)}...{check.creator.substring(38)}</strong>
            </div>
          </div>
          
          <div className="compliance-section">
            <h3>Compliance Verification</h3>
            
            <div className="verification-controls">
              <div className="data-status">
                Status: {check.isVerified ? 
                  "✅ On-chain Verified" : 
                  "🔒 FHE Encrypted"}
              </div>
              <button 
                className={`verify-btn metal-btn ${check.isVerified ? 'verified' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 Verifying..." :
                 check.isVerified ? "✅ Verified" : 
                 "🔓 Verify Risk Score"}
              </button>
            </div>
            
            {renderComplianceChart(check)}
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


