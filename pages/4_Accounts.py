import streamlit as st
from data_sources import FakeDataSource
ds = FakeDataSource()
st.title("💼 Accounts")
stats = ds.get_accounts_stats()
stats['Balance'] = stats['Balance'].apply(lambda x: f"${x:,.0f}")
stats['Equity'] = stats['Equity'].apply(lambda x: f"${x:,.0f}")
stats['PnL'] = stats['PnL'].apply(lambda x: f"${x:,.0f}")
st.dataframe(stats, use_container_width=True)
account = st.selectbox("Select Account", stats['Account'].tolist())
if account:
    details = ds.get_account_details(account)
    st.json(details)